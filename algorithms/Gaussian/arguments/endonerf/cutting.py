# 数据集参数
ModelParams = dict(
    extra_mark = 'endonerf',
    camera_extent = 10                  # 相机范围-用于归一化
)
# 训练参数
OptimizationParams = dict(
    coarse_iterations = 1000,           # 粗训练迭代次数（通常1000-3000）
    deformation_lr_init = 0.00016,      # 变形网络初始学习率
    deformation_lr_final = 0.0000016,
    deformation_lr_delay_mult = 0.01,
    grid_lr_init = 0.0016,
    grid_lr_final = 0.000016,           
    iterations = 3000,                  # 精细训练迭代次数（通常30000-60000）
    percent_dense = 0.01,
    opacity_reset_interval = 3000,      # 不透明度重置间隔
    position_lr_max_steps = 4000,
    prune_interval = 3000
)
# 模型参数
ModelHiddenParams = dict(
    kplanes_config = {
     'grid_dimensions': 2,
     'input_coordinate_dim': 4,
     'output_coordinate_dim': 64,
     'resolution': [64, 64, 64, 100]    # K-planes网格分辨率 [x, y, z, t]
    },
    multires = [1, 2, 4, 8],
    defor_depth = 0,                    # 变形网络深度
    net_width = 32,                     # MLP网络宽度
    plane_tv_weight = 0,
    time_smoothness_weight = 0,         # 时间平滑权重
    l1_time_planes =  0,
    weight_decay_iteration=0,
)