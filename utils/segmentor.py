# set-up
import os
from tqdm  import tqdm
import numpy as np
import torch
from PIL import Image
from algorithms.sam2.build_sam import build_sam2_video_predictor, build_sam2
from algorithms.sam2.sam2_image_predictor import SAM2ImagePredictor
import config

CHECKPOINT=f'{config.CHECKPOINTS_PATH}/sam2.1_hiera_large.pt' 
CONFIG = "configs/sam2.1/sam2.1_hiera_l.yaml"

def select_device():
    # select the device for computation
    device = None
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    print(f"using device: {device}")

    if device.type == "cuda":
        # use bfloat16 for the entire notebook
        torch.autocast("cuda", dtype=torch.bfloat16).__enter__()
        # turn on tfloat32 for Ampere GPUs (https://pytorch.org/docs/stable/notes/cuda.html#tensorfloat-32-tf32-on-ampere-devices)
        if torch.cuda.get_device_properties(0).major >= 8:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
    elif device.type == "mps":
        print(
            "\nSupport for MPS devices is preliminary. SAM 2 is trained with CUDA and might "
            "give numerically different outputs and sometimes degraded performance on MPS. "
            "See e.g. https://github.com/pytorch/pytorch/issues/84936 for a discussion."
        )
    return device
        
def video_sam2_inference(video_dir, masks_dir, prompts, expand_u=3):
    """
    video_dir：视频帧存放目录
    prompts：列表，包含点坐标。
    """
    # device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    device = select_device()

    # 1.初始化预测器
    predictor = build_sam2_video_predictor(CONFIG, CHECKPOINT, device=device)

    # 2.初始化推理状态
    inference_state = predictor.init_state(video_path=video_dir)
    predictor.reset_state(inference_state)

    # 3.添加交互点（Prompts）
    for p in prompts:
        predictor.add_new_points_or_box(
            inference_state=inference_state,
            frame_idx = p["frame_idx"],
            obj_id = p["obj_id"],
            points=np.array(p["points"], dtype=np.float32),
            labels=np.array(p["labels"], dtype=np.int32)
        )
    
    # 4.在视频中传播
    os.makedirs(masks_dir, exist_ok=True)

    from scipy.ndimage import binary_dilation  # 导入膨胀函数
    
    # 定义扩展的大小（结构元素）
    # 3个单位通常指半径，这里创建一个 3x3 或 7x7 的结构元素
    # 迭代次数 iterations=3 可以精确控制向外扩展的像素单位
    struct_element = np.ones((3, 3), dtype=bool) 

    print("Start video dissemination prediction")
    for out_frame_idx, out_obj_ids, out_mask_logits in tqdm(predictor.propagate_in_video(inference_state,start_frame_idx=0), desc="Propagating", unit="frame"):
        combined_mask = None

        for i, out_obj_id in enumerate(out_obj_ids):
            # 将 logit 转化为二值化 numpy 数组 (布尔型)
            mask_bool = (out_mask_logits[i] > 0.0).cpu().numpy()
            
            # 合并对象
            if combined_mask is None:
                combined_mask = mask_bool
            else:
                combined_mask = np.logical_or(combined_mask, mask_bool)

        if combined_mask is not None:
            # 边缘向外扩展 3 个单位 ---
            # combined_mask[0] 取出 (H, W) 矩阵进行处理
            dilated_mask = binary_dilation(combined_mask[0], structure=struct_element, iterations=expand_u)
            # 转换为 0/255 的 uint8 图像
            mask_img = Image.fromarray((dilated_mask * 255).astype(np.uint8))
            
            # 保存
            save_path = os.path.join(masks_dir, f"{out_frame_idx:05d}.png")
            mask_img.save(save_path)

    print(f"All the expanded binary masks have been saved to: {masks_dir}")
    return masks_dir


def image_sam2_inference(image_path, mask_path, input_points, input_labels, expand_u=3):
    """
    image_path: 待处理图片路径
    save_mask_path: 掩码保存路径 (例如: 'result_mask.png')
    prompts: 单个字典，例如 {"points": [[x1, y1]], "labels": [1]}
    expand_u: 膨胀像素单位
    """
    device = select_device()
    
    # 1. 初始化模型和预测器
    # 注意：build_sam2 用于普通预测，区别于视频流预测器
    sam2_model = build_sam2(CONFIG, CHECKPOINT, device=device)
    predictor = SAM2ImagePredictor(sam2_model)

    # 2. 加载图片
    image = Image.open(image_path).convert("RGB")
    image_np = np.array(image)
    predictor.set_image(image_np)

    # 3. 准备 Prompt 数据
    # 从 prompts 字典中提取坐标和标签
    # input_points = np.array(prompts["points"], dtype=np.float32)
    # input_labels = np.array(prompts["labels"], dtype=np.int32)

    # 4. 执行推理
    # multimask_output=False 通常在点位足够精准时使用，得到最明确的一个结果
    masks, scores, logits = predictor.predict(
        point_coords=input_points,
        point_labels=input_labels,
        multimask_output=False, 
    )

    # 5. 处理结果 (获取置信度最高的 mask)
    # masks 形状为 [n, h, w]，如果 multimask_output=False，则 n=1
    best_mask = masks[0] 

    # 6. 形态学膨胀 (边缘向外扩展)
    from scipy.ndimage import binary_dilation
    if expand_u > 0:
        struct_element = np.ones((3, 3), dtype=bool) 
        dilated_mask = binary_dilation(best_mask, structure=struct_element, iterations=expand_u)
    else:
        dilated_mask = best_mask

    # 7. 保存为 0/255 的灰度图
    mask_img = Image.fromarray((dilated_mask * 255).astype(np.uint8))
    
    # 确保目录存在
    os.makedirs(os.path.dirname(os.path.abspath(mask_path)), exist_ok=True)
    mask_img.save(mask_path)

    print(f"Image mask saved to: {mask_path}")
    return mask_path

# # 修改 main 中的调用示例
# if __name__ == '__main__':
#     # 视频推理示例
#     # video_sam2_inference('data/frames', 'data/masks', MY_PROMPTS)

#     # 图像推理示例
#     IMAGE_PROMPT = {
#         "points": [[300, 320], [600, 350],[320, 280]], 
#         "labels": [1,1,1]
#     }
#     image_sam2_inference('/home/hxuefeng/Study/v5/00090.jpg', 'output/test_mask.png', IMAGE_PROMPT, expand_u=3)
