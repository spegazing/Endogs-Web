from flask import Blueprint, render_template, request, jsonify, send_from_directory
import config
import uuid
import os
from utils.img_handle import extract_frames
import numpy as np
import cv2
import zipfile
import shutil

upd = Blueprint('upload', __name__)

@upd.route('/check_project/<project_id>')
def check_project(project_id):
    """检查项目状态"""
    project_path = os.path.join(config.PROCESS_DIR, project_id)
    
    status = {
        'project_id': project_id,
        'exists': os.path.exists(project_path),
        'images': False,
        'jpg_images': False,
        'depth': False,
        'mask': False
    }
    
    if os.path.exists(project_path):
        status['images'] = os.path.exists(os.path.join(project_path, 'images'))
        status['jpg_images'] = os.path.exists(os.path.join(project_path, 'jpg_images'))
        status['depth'] = os.path.exists(os.path.join(project_path, 'depth'))
        status['mask'] = os.path.exists(os.path.join(project_path, 'mask'))
    
    return jsonify(status)

@upd.route('/get_image/<project_id>/<filename>')
def get_image(project_id, filename):
    directory = os.path.join(config.PROCESS_DIR, project_id, "jpg_images")
    return send_from_directory(directory, filename)

@upd.route('/upload', methods=['POST'])
def upload_video():
    upload_type = request.form.get('type')
    project_id = str(uuid.uuid4())[:8]
    project_path = os.path.join(config.PROCESS_DIR, project_id)
    
    try:
        png_dir = os.path.join(project_path, "images")
        jpg_dir = os.path.join(project_path, "jpg_images")
        os.makedirs(png_dir, exist_ok=True)
        os.makedirs(jpg_dir, exist_ok=True)
        
        os.makedirs(os.path.join(project_path, "depth"), exist_ok=True)
        os.makedirs(os.path.join(project_path, "masks"), exist_ok=True)

        file = request.files['file']
        
        if upload_type == 'video':
            # --- 检查文件大小 ---
            file.seek(0, os.SEEK_END)   # 移动到文件末尾
            file_size = file.tell()     # 获取当前指针位置（即文件大小，单位：字节）
            file.seek(0)                # ⚠️ 必须移回文件开头，否则 save() 会失败或只保存空文件
            
            max_size = 200 * 1024 * 1024  # 200 MB
            
            if file_size > max_size:
                return jsonify({"success": False, "message": "视频文件大小不能超过 200MB"}), 400

            video_path = os.path.join(project_path, file.filename)
            file.save(video_path)
            extract_frames(video_path, png_dir)
            
            # 获取图片数量
            image_count = len([f for f in os.listdir(png_dir) if f.endswith('.png')])
            
            return jsonify({
                "success": True,
                "message": "视频上传成功并完成抽帧", 
                "project_id": project_id, 
                "image_count": image_count
            })

        elif upload_type == 'zip':
            zip_path = os.path.join(project_path, file.filename)
            file.save(zip_path)
            
            # 解压处理
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                namelist = [n for n in zip_ref.namelist() 
                           if n.lower().endswith(('.png', '.jpg', '.jpeg')) 
                           and not n.startswith('__') and not n.startswith('.')]
                namelist.sort()

                for i, name in enumerate(namelist):
                    data = zip_ref.read(name)
                    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
                    
                    if img is None: 
                        continue

                    # 缩放逻辑
                    h, w = img.shape[:2]
                    if w > 700:
                        new_w = 768
                        new_h = int(h * (768 / w))
                        interp = cv2.INTER_AREA if w > 768 else cv2.INTER_LINEAR
                        img = cv2.resize(img, (new_w, new_h), interpolation=interp)

                    # 统一命名保存
                    frame_name = f"{i:05d}"
                    cv2.imwrite(os.path.join(png_dir, f"{frame_name}.png"), img)
                    cv2.imwrite(os.path.join(jpg_dir, f"{frame_name}.jpg"), img, 
                               [int(cv2.IMWRITE_JPEG_QUALITY), 95])
            
            # 删除原始zip包
            os.remove(zip_path)
            
            image_count = len([f for f in os.listdir(png_dir) if f.endswith('.png')])
            
            return jsonify({
                "success": True,
                "message": "图像序列解压并处理成功", 
                "project_id": project_id, 
                "image_count": image_count
            })

        return jsonify({"success": False, "error": "无效的上传类型"}), 400
        
    except Exception as e:
        import traceback
        print(f"Upload error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({
            "success": False, 
            "error": f"处理失败: {str(e)}"
        }), 500