from flask import Blueprint, request, jsonify, send_from_directory
import config
import os
import subprocess
import sys
from utils.reconstruct import train, render, metrics
import traceback
from algorithms.Gaussian.arguments.endonerf.cutting import OptimizationParams as Op

reconstruct_bp = Blueprint('reconstruct', __name__)

@reconstruct_bp.route('/reconstruct', methods=['POST'])
def reconstruct():
    """开始三维重建"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "无效的请求数据"}), 400
            
        project_id = data.get('project_id')

        # 更新配置
        config.User_coarse_iterations = data.get('coarse_iterations')
        config.User_iterations = data.get('iterations')
        config.User_percent_dense = data.get('percent_dense')

        print(config.User_coarse_iterations,config.User_iterations, config.User_percent_dense)
        
        if not project_id:
            return jsonify({"error": "缺少项目ID"}), 400
        
        # 设置路径
        source_path = os.path.join(config.PROCESS_DIR, project_id)
        exp_path = os.path.join(config.RESULT_DIR, project_id)
        
        
        # 检查源目录是否存在
        if not os.path.exists(source_path):
            return jsonify({"error": f"项目目录不存在: {source_path}"}), 400
        os.makedirs(exp_path, exist_ok=True)
        
        # 配置文件路径
        configs = 'algorithms/Gaussian/arguments/endonerf/cutting.py'
        
        # 相机位姿文件路径
        pose_path = source_path
        
        print(f"开始重建: source_path={source_path}, exp_path={exp_path}")
        
        # 处理相机位姿
        try:
            from algorithms.pose import process_posesbound
            process_posesbound(pose_path)
            print("相机位姿处理完成")
        except Exception as e:
            print(f"相机位姿处理失败: {str(e)}")
            traceback.print_exc()
            return jsonify({"error": f"相机位姿处理失败: {str(e)}"}), 500

        # # 更新图像参数
        # images_dir = os.path.join(source_path, "images")
        # if os.path.exists(images_dir):
        #     files = os.listdir(images_dir)
        #     image_files = [f for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
        #     image_files.sort() 
            
        #     if image_files:
        #         first_image_path = os.path.join(images_dir, image_files[0])
        #         import cv2
        #         img = cv2.imread(first_image_path)
        #         if img is not None:
        #             # 获取高度和宽度
        #             h, w = img.shape[:2]
        #             # --- 同步到配置 ---
        #             config.IMG_WIDTH = w
        #             config.IMG_HEIGHT = h
        #         else:
        #             print("无法读取第一张图片")
        #     else:
        #         print("images 目录下没有找到图片文件")
        # else:
        #     print("images 目录不存在")

        # # 开始训练
        # try:
        #     print("开始训练...")
        #     train(source_path=source_path, expname=exp_path, configs=configs)
        #     print("训练完成")
        # except Exception as e:
        #     print(f"训练失败: {str(e)}")
        #     traceback.print_exc()
        #     return jsonify({"error": f"训练失败: {str(e)}"}), 500

        # # 渲染
        # try:
        #     print("开始渲染...")
        #     model_path = exp_path
        #     render(project_id=project_id, model_path=model_path, configs=configs)
        #     print("渲染完成")
        # except Exception as e:
        #     print(f"渲染失败: {str(e)}")
        #     traceback.print_exc()
        #     return jsonify({"error": f"渲染失败: {str(e)}"}), 500

        # # 评估
        # try:
        #     print("开始评估...")
        #     model_path = [exp_path]
        #     scene_dir, method, metric_dict = metrics(model_path)
        #     print("评估完成")
        # except Exception as e:
        #     print(f"评估失败: {str(e)}")
        #     traceback.print_exc()
        #     return jsonify({"error": f"评估失败: {str(e)}"}), 500
        
        # 检查生成的PLY文件
        ply_dir = os.path.join(config.RECONSTRUCT_DIR, project_id)

        if os.path.exists(ply_dir):
            ply_files = [f for f in os.listdir(ply_dir) if f.endswith('.ply')]
            ply_count = len(ply_files)
        else:
            ply_count = 0
        
        return jsonify({
            "message": f"重建成功，生成 {ply_count} 个PLY文件",
            "project_id": project_id,
            "ply_count": ply_count,
            "SSIM":metric_dict[scene_dir][method]["SSIM"],
            "PSNR":metric_dict[scene_dir][method]["PSNR"],
            "LPIPS":metric_dict[scene_dir][method]["LPIPS"],
            "FLIP":metric_dict[scene_dir][method]["FLIP"]
        })
        
    except Exception as e:
        print(f"重建过程出错: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": f"重建失败: {str(e)}"}), 500


@reconstruct_bp.route('/get_ply_frames/<project_id>')
def get_ply_frames(project_id):
    """获取PLY文件列表"""
    try:

        ply_dir = os.path.join(config.RECONSTRUCT_DIR, project_id)

        if not os.path.exists(ply_dir):
            return jsonify({"frames": [], "count": 0})
        
        ply_files = [f for f in os.listdir(ply_dir) if f.endswith('.ply')] 
        ply_files.sort()  # 确保按顺序
    
        return jsonify({
            "frames": ply_files,
            "count": len(ply_files)
        })
    except Exception as e:
        print(f"获取PLY文件列表失败: {str(e)}")
        return jsonify({"error": str(e)}), 500

@reconstruct_bp.route('/get_ply_file/<project_id>/<filename>')
def get_ply_file(project_id, filename):
    """获取PLY文件 """
    try:

        ply_dir = os.path.join(config.RECONSTRUCT_DIR, project_id)

        if not os.path.isdir(ply_dir):
            print(f"[ERROR] 目录不存在: {ply_dir}")
            
        file_path = os.path.join(ply_dir, filename)

        if not os.path.isfile(file_path):
            print(f"[ERROR] 文件不存在: {file_path}")
            
        print(f"[INFO] 正在发送文件: {filename}")
        return send_from_directory(ply_dir, filename, as_attachment=False)
        
    except Exception as e:
        print(f"[CRITICAL ERROR] 发生未捕获异常: {str(e)}")
        import traceback
        traceback.print_exc() # 这里会打印出详细的报错堆栈
        return jsonify({"error": f"服务器内部错误: {str(e)}"}), 500