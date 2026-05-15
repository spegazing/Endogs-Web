import torch
from algorithms.Gaussian.train import setup_seed
from argparse import ArgumentParser, Namespace
from algorithms.Gaussian.arguments import ModelParams, PipelineParams, OptimizationParams, ModelHiddenParams
from algorithms.Gaussian.utils.general_utils import safe_state
from algorithms.Gaussian.utils.params_utils import merge_hparams
from algorithms.Gaussian.gaussian_renderer import render, network_gui
from algorithms.Gaussian.arguments import get_combined_args

def train(source_path=None, expname=None, port=6009, configs=None):
    """
    训练函数封装
    
    Args:
        source_path (str): 数据源路径 (-s 参数)
        expname (str): 输出项目名 (--expname 参数)
        port (int): GUI服务器端口 (--port 参数)
        configs (str): 配置文件路径 (--configs 参数)
    """
    # 创建参数对象
    parser = ArgumentParser(description="Training script parameters")
    lp = ModelParams(parser)
    op = OptimizationParams(parser)
    pp = PipelineParams(parser)
    hp = ModelHiddenParams(parser)

    # 参数设置
    parser.add_argument('--ip', type=str, default="127.0.0.1")
    parser.add_argument('--port', type=int, default=6009)
    parser.add_argument('--debug_from', type=int, default=-1)
    parser.add_argument('--detect_anomaly', action='store_true', default=False)
    parser.add_argument("--test_iterations", nargs="+", type=int, default=[i*500 for i in range(0,120)])
    parser.add_argument("--save_iterations", nargs="+", type=int, default=[2000, 3000,4000, 5000, 6000, 9000, 10000, 14000, 20000, 30_000,45000,60000])
    parser.add_argument("--checkpoint_iterations", nargs="+", type=int, default=[])
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--start_checkpoint", type=str, default = None)
    parser.add_argument("--expname", type=str, default = "")
    parser.add_argument("--configs", type=str, default = "")

    # 创建一个包含所有参数的 Namespace 对象
    args = parser.parse_args([])  # 使用空列表创建默认参数
     # 更新参数
    if source_path:
        args.source_path = source_path
    if expname:
        args.expname = expname
    if port:
        args.port = port
    if configs:
        args.configs = configs
    
     # 设置保存迭代
    args.save_iterations.append(args.iterations)
    
    # 加载配置文件
    if args.configs:
        from mmengine import Config
        config = Config.fromfile(args.configs)
        args = merge_hparams(args, config)
    
    print("Optimizing " + args.model_path)

    # 初始化系统状态
    safe_state(args.quiet)

    # 启动GUI服务器
    network_gui.init(args.ip, args.port)
    torch.autograd.set_detect_anomaly(args.detect_anomaly)
    
    # 开始训练
    from algorithms.Gaussian.train import training
    training(args, lp.extract(args), hp.extract(args), op.extract(args), pp.extract(args), 
             args.test_iterations, args.save_iterations, args.checkpoint_iterations, 
             args.start_checkpoint, args.debug_from, args.expname, args.extra_mark)

    print("\nTraining complete.")

def render(project_id=0, model_path=None, configs=None, iteration=-1, 
           skip_train=True, skip_test=False, skip_video=True, reconstruct=True):
    """
    渲染函数封装
    
    Args:
        model_path (str): 模型输出路径 (--model_path 参数)
        configs (str): 配置文件路径 (--configs 参数)
        iteration (int): 迭代次数 (--iteration 参数)
        skip_train (bool): 是否跳过训练集渲染
        skip_test (bool): 是否跳过测试集渲染
        skip_video (bool): 是否跳过视频渲染
        reconstruct (bool): 是否重建点云
    """
    import psutil
    # 设置 CPU 亲和性
    cpu_count = psutil.cpu_count()
    cpu_list = list(range(cpu_count))[1:2]
    psutil.Process().cpu_affinity(cpu_list)
    
    # 创建参数解析器
    parser = ArgumentParser(description="Testing script parameters")
    model_params = ModelParams(parser, sentinel=True)  # 改名避免与参数冲突
    pipeline = PipelineParams(parser)
    hyperparam = ModelHiddenParams(parser)
    parser.add_argument("--iteration", default=-1, type=int)
    parser.add_argument("--skip_train", action="store_true")
    parser.add_argument("--skip_test", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--skip_video", action="store_true")
    parser.add_argument("--configs", type=str)
    parser.add_argument("--reconstruct", action="store_true")
    
    # 创建传入参数的字典
    input_args = {
        'model_path': model_path,
        'configs': configs,
        'iteration': iteration,
        'skip_train': skip_train,
        'skip_test': skip_test,
        'skip_video': skip_video,
        'reconstruct': reconstruct
    }
    
    # 使用修改后的 get_combined_args
    args = get_combined_args(parser, input_args)
    
    print("Rendering ", args.model_path)
    print(f"Source path from config: {getattr(args, 'source_path', 'Not found in config')}")
    
    # 加载配置文件（如果指定了 configs）
    if args.configs:
        try:
            from mmengine import Config
            from algorithms.Gaussian.utils.params_utils import merge_hparams
            config = Config.fromfile(args.configs)
            args = merge_hparams(args, config)
        except Exception as e:
            print(f"Warning: Could not load config file: {e}")
    
    # 初始化系统状态
    safe_state(args.quiet)
    
    # 调用渲染函数
    from algorithms.Gaussian.render import render_sets
    render_sets(
        project_id,
        model_params.extract(args), 
        hyperparam.extract(args), 
        args.iteration, 
        pipeline.extract(args), 
        args.skip_train, 
        args.skip_test, 
        args.skip_video, 
        args.reconstruct
    )


def metrics(model_paths):
    """
    评估结果
    """
    device = torch.device("cuda:0")
    torch.cuda.set_device(device)

    from algorithms.Gaussian.metrics import evaluate

    metric_dict = evaluate(model_paths)
    return metric_dict