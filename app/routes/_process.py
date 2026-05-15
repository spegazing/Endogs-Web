from flask import Blueprint, request, jsonify, send_from_directory, json
import config
import os
import uuid
import zipfile
import numpy as np
import cv2
from utils.depth_estimator import depth_estimate
from utils.segmentor import video_sam2_inference
from utils.img_handle import convert_depth_to_single_channel, apply_mask_to_depth
import shutil
from algorithms.pose import process_posesbound

process_bp = Blueprint('process', __name__)

@process_bp.route('/upload_depth', methods=['POST'])
def upload_depth():
    """上传已有深度图压缩包"""
    project_id = request.form.get('project_id')
    if not project_id:
        return jsonify({"error": "缺少项目ID"}), 400
    
    project_path = os.path.join(config.PROCESS_DIR, project_id)
    depth_dir = os.path.join(project_path, "depth")
    os.makedirs(depth_dir, exist_ok=True)
    file = request.files['file']
    zip_path = os.path.join(project_path, 'depth_upload.zip')
    file.save(zip_path)
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # 获取所有图片文件
            namelist = [n for n in zip_ref.namelist() 
                       if n.lower().endswith(('.png', '.jpg', '.jpeg', '.tiff')) 
                       and not n.startswith('__')]
            namelist.sort()
            
            for i, name in enumerate(namelist):
                data = zip_ref.read(name)
                img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
                
                if img is None:
                    continue
                
                # 如果是彩色图，转换为单通道
                if len(img.shape) == 3:
                    img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                
                # 保存为png格式
                frame_name = f"{i:05d}.png"
                cv2.imwrite(os.path.join(depth_dir, frame_name), img)
        
        os.remove(zip_path)
        return jsonify({
            "message": f"深度图上传成功，共处理{len(namelist)}张",
            "project_id": project_id,
            "image_count": len(namelist)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@process_bp.route('/get_img_count/<project_id>/<mode>', methods=['GET'])
def get_img_count(project_id, mode):
    """获取帧数量"""
    try:
        project_path = os.path.join(config.PROCESS_DIR, project_id)
        # mode直接对应文件夹名
        img_dir = os.path.join(project_path, mode)
        if not os.path.exists(img_dir):
            return jsonify({"image_count": 0})
        # 只计数图片文件
        count = len([f for f in os.listdir(img_dir) 
                    if f.lower().endswith(('.png', '.jpg', '.jpeg'))])
        return jsonify({"image_count": count})

    except Exception as e:
        return jsonify({"image_count": 0, "error": str(e)}), 500

@process_bp.route('/estimate_depth', methods=['POST'])
def estimate_depth():
    """调用深度估计模型"""
    data = request.get_json()
    project_id = data.get('project_id')
    
    if not project_id:
        return jsonify({"error": "缺少项目ID"}), 400
    
    project_path = os.path.join(config.PROCESS_DIR, project_id)
    img_dir = os.path.join(project_path, "images")  # PNG原图
    depth3_dir = os.path.join(project_path, "depth3")
   
    try:
        # 调用深度估计函数
        depth_estimate(img_dir, depth3_dir)

        # 单通道处理
        depth1_dir = os.path.join(project_path, 'depth1')
        convert_depth_to_single_channel(depth3_dir, depth1_dir)

        # depth -mask 处理
        depth_dir = os.path.join(project_path, 'depth')
        masks_dir = os.path.join(project_path, 'masks')
        apply_mask_to_depth(masks_dir, depth1_dir, depth_dir)

        # 统计生成的深度图数量
        depth_count = len([f for f in os.listdir(depth_dir) if f.endswith('.png')])
        return jsonify({
            "message": f"深度估计完成，生成{depth_count}张深度图",
            "project_id": project_id,
            "image_count": depth_count
        })
    except Exception as e:
        return jsonify({"error": f"深度估计失败: {str(e)}"}), 500

@process_bp.route('/upload_mask', methods=['POST'])
def upload_mask():
    """上传已有掩码图压缩包"""
    project_id = request.form.get('project_id')
    if not project_id:
        return jsonify({"error": "缺少项目ID"}), 400
    
    project_path = os.path.join(config.PROCESS_DIR, project_id)
    mask_dir = os.path.join(project_path, "masks")
    os.makedirs(mask_dir, exist_ok=True)
    
    file = request.files['file']
    zip_path = os.path.join(project_path, 'mask_upload.zip')
    file.save(zip_path)
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            namelist = [n for n in zip_ref.namelist() 
                       if n.lower().endswith(('.png', '.jpg', '.jpeg')) 
                       and not n.startswith('__')]
            namelist.sort()
            
            for i, name in enumerate(namelist):
                data = zip_ref.read(name)
                img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
                
                if img is None:
                    continue
                
                # 二值化处理
                _, binary = cv2.threshold(img, 127, 255, cv2.THRESH_BINARY)
                
                frame_name = f"{i:05d}.png"
                cv2.imwrite(os.path.join(mask_dir, frame_name), binary)
        
        os.remove(zip_path)
        return jsonify({
            "message": f"掩码图上传成功，共处理{len(namelist)}张",
            "project_id": project_id,
            "image_count": len(namelist)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@process_bp.route('/segment_mask', methods=['POST'])
def segment_mask():
    """
    交互式分割生成掩码 - 保持向后兼容
    默认调用多帧传播版本
    """
    data = request.get_json()
    propagate = data.get('propagate', True)  # 默认传播到其他帧
    
    if not propagate:
        # 如果propagate=False，调用单帧分割
        return segment_single_frame()
    
    project_id = data.get('project_id')
    frame_idx = data.get('frame_idx')
    points = data.get('points', [])
    labels = data.get('labels', [])
    
    if not all([project_id, frame_idx is not None, points, labels]):
        return jsonify({"error": "参数不完整"}), 400
    
    project_path = os.path.join(config.PROCESS_DIR, project_id)
    video_dir = os.path.join(project_path, "jpg_images")  # video_sam2_inference需要视频帧目录
    
    # 构建prompts格式
    # 使用固定的obj_id=1，因为单对象分割
    prompts = [{
        "frame_idx": frame_idx,
        "obj_id": 1,  # 固定对象ID
        "points": points,  # 直接使用[[x,y], ...]格式
        "labels": labels   # 直接使用[1,0,1,...]格式
    }]
    
    try:
        # 调用video_sam2_inference处理整个视频序列
        # 函数内部会生成所有帧的掩码
        mask_output_dir = video_sam2_inference(
            video_dir=video_dir,
            prompts=prompts,
            # 如果有特殊参数可以在这里传入
        )
        
        # 统计生成的掩码数量
        mask_dir = os.path.join(project_path, "mask")
        mask_count = len([f for f in os.listdir(mask_dir) if f.endswith('.png')])
        
        return jsonify({
            "message": f"帧{frame_idx}掩码生成成功，并传播至其他帧",
            "project_id": project_id,
            "frame_idx": frame_idx,
            "mask_count": mask_count
        })
    except Exception as e:
        return jsonify({"error": f"分割失败: {str(e)}"}), 500

@process_bp.route('/segment_single_frame', methods=['POST'])
def segment_single_frame():
    """
    单帧交互式分割
    只处理指定帧，生成掩码并替换原有文件，不传播到其他帧
    """
    try:
        data = request.get_json()
        project_id = data.get('project_id')
        frame_idx = data.get('frame_idx')
        points = data.get('points', [])
        labels = data.get('labels', [])
        
        if not all([project_id, frame_idx is not None]):
            return jsonify({"error": "参数不完整"}), 400
        
        if not points or not labels:
            return jsonify({"error": "请至少添加一个标记点"}), 400
        
        project_path = os.path.join(config.PROCESS_DIR, project_id)
        img_path = os.path.join(project_path, f'jpg_images/{frame_idx:05d}.jpg')
        mask_path = os.path.join(project_path, f'masks/{frame_idx:05d}.png')

        from utils.segmentor import image_sam2_inference
        
        mask_path = image_sam2_inference(
            image_path=img_path,
            mask_path=mask_path,
            input_points=points,
            input_labels=labels,   
        )
        
        return jsonify({
            "message": f"帧{frame_idx}掩码生成成功",
            "project_id": project_id,
            "frame_idx": frame_idx,
            "mask_path": mask_path
        })
        
    except Exception as e:
        print(f"Error in segment_single_frame: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"分割失败: {str(e)}"}), 500

@process_bp.route('/segment_multi_frames', methods=['POST'])
def segment_multi_frames():
    """
    多帧交互式分割
    接收多个帧的标记点，批量处理并传播到整个视频
    """
    try:
        data = request.get_json()
        project_id = data.get('project_id')
        frame_prompts = data.get('prompts', [])
        
        if not project_id or not frame_prompts:
            return jsonify({"error": "参数不完整"}), 400
        
        print(f"Multi-frame segmentation received: {len(frame_prompts)} prompts")
        
        project_path = os.path.join(config.PROCESS_DIR, project_id)
        video_dir = os.path.join(project_path, "jpg_images")  # 使用jpg_images目录
        
        # 检查目录是否存在
        if not os.path.exists(video_dir):
            video_dir = os.path.join(project_path, "images")  # 备选
            if not os.path.exists(video_dir):
                return jsonify({"error": f"视频帧目录不存在"}), 400
        
        # 转换为video_sam2_inference所需的prompts格式
        prompts = []
        for i, fp in enumerate(frame_prompts):
            prompt = {
                "frame_idx": fp.get('frame_idx'),
                "obj_id": fp.get('obj_id', i + 1),  # 每个对象使用不同的obj_id
                "points": fp.get('points', []),
                "labels": fp.get('labels', [])
            }
            prompts.append(prompt)
        
        print(f"Calling video_sam2_inference with {len(prompts)} prompts")
        masks_dir = os.path.join(os.path.dirname(video_dir), 'masks')
        # 调用video_sam2_inference
        mask_output_dir = video_sam2_inference(
            video_dir=video_dir,
            masks_dir=masks_dir,
            prompts=prompts
        )
        
        # 统计生成的掩码数量
        mask_dir = os.path.join(project_path, "masks")
        if os.path.exists(mask_dir):
            mask_count = len([f for f in os.listdir(mask_dir) if f.endswith('.png')])
        else:
            mask_count = 0
        
        print(f"Multi-frame segmentation completed. Generated {mask_count} masks")
        
        return jsonify({
            "message": f"成功处理{len(prompts)}帧标记点，生成{mask_count}张掩码",
            "project_id": project_id,
            "mask_count": mask_count,
            "processed_frames": [p.get('frame_idx') for p in prompts]
        })
    except Exception as e:
        print(f"Error in segment_multi_frames: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"分割失败: {str(e)}"}), 500

@process_bp.route('/get_depth/<project_id>/<filename>')
def get_depth(project_id, filename):
    """获取深度图"""
    directory = os.path.join(config.PROCESS_DIR, project_id, "depth")
    return send_from_directory(directory, filename)

@process_bp.route('/get_mask/<project_id>/<filename>')
def get_mask(project_id, filename):
    """获取掩码图"""
    directory = os.path.join(config.PROCESS_DIR, project_id, "masks")
    return send_from_directory(directory, filename)

@process_bp.route('/update_mask_points', methods=['POST'])
def update_mask_points():
    """
    更新多帧的标记点（用于批量调整）
    接收多帧标记点数据，重新运行分割
    """
    data = request.get_json()
    project_id = data.get('project_id')
    frames_data = data.get('frames', [])  # [{frame_idx, points, labels}]
    
    if not project_id or not frames_data:
        return jsonify({"error": "参数不完整"}), 400
    
    project_path = os.path.join(config.PROCESS_DIR, project_id)
    video_dir = os.path.join(project_path, "images")
    
    # 构建prompts格式
    prompts = []
    for i, frame_info in enumerate(frames_data):
        frame_idx = frame_info.get('frame_idx')
        points = frame_info.get('points', [])
        labels = frame_info.get('labels', [])
        
        if points and labels:  # 只添加有标记点的帧
            prompt = {
                "frame_idx": frame_idx,
                "obj_id": i + 1,  # 每个对象使用不同的obj_id
                "points": points,
                "labels": labels
            }
            prompts.append(prompt)
    
    try:
        # 重新运行整个视频的分割
        mask_output_dir = video_sam2_inference(
            video_dir=video_dir,
            prompts=prompts
        )
        
        mask_dir = os.path.join(project_path, "mask")
        mask_count = len([f for f in os.listdir(mask_dir) if f.endswith('.png')])
        
        results = [{"frame_idx": f.get('frame_idx'), "success": True} for f in frames_data]
        
        return jsonify({
            "message": f"已更新{len(results)}帧标记点，重新生成{mask_count}张掩码",
            "project_id": project_id,
            "mask_count": mask_count,
            "results": results
        })
    except Exception as e:
        return jsonify({"error": f"分割失败: {str(e)}"}), 500

@process_bp.route('/get_frame_points/<project_id>/<int:frame_idx>', methods=['GET'])
def get_frame_points(project_id, frame_idx):
    """
    获取指定帧已保存的标记点
    """
    # 这里需要您实现一个存储标记点的机制
    # 例如保存到JSON文件或数据库中
    project_path = os.path.join(config.PROCESS_DIR, project_id)
    points_file = os.path.join(project_path, "annotations", f"frame_{frame_idx:05d}.json")
    
    if os.path.exists(points_file):
        with open(points_file, 'r') as f:
            data = json.load(f)
        return jsonify(data)
    else:
        return jsonify({"frame_idx": frame_idx, "points": [], "labels": []})