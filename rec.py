import config
import os
import subprocess
import sys
from utils.reconstruct import train, render
import traceback


if __name__ == "__main__":

    """开始三维重建"""
    try:        
        # 设置路径
        project_id = 'f204e1d5'
        source_path = os.path.join(config.PROCESS_DIR, project_id)
        exp_path = os.path.join('/test_reconstruct', project_id)
            
        # 创建结果目录
        os.makedirs(exp_path, exist_ok=True)
        
        # 配置文件路径
        configs = 'algorithms/Gaussian/arguments/endonerf/cutting.py'
        
        # 更新图像参数
        images_dir = os.path.join(source_path, "images")
        if os.path.exists(images_dir):
            files = os.listdir(images_dir)
            image_files = [f for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
            image_files.sort() 
            
            if image_files:
                first_image_path = os.path.join(images_dir, image_files[0])
                import cv2
                img = cv2.imread(first_image_path)
                if img is not None:
                    # 获取高度和宽度
                    h, w = img.shape[:2]
                    # --- 同步到配置 ---
                    config.IMG_WIDTH = w
                    config.IMG_HEIGHT = h
                else:
                    print("无法读取第一张图片")
            else:
                print("images 目录下没有找到图片文件")
        else:
            print("images 目录不存在")

        # 开始训练
        try:
            print("开始训练...")
            train(source_path=source_path, expname=exp_path, configs=configs)
            print("训练完成")
        except Exception as e:
            print(f"训练失败: {str(e)}")
            traceback.print_exc()
            return jsonify({"error": f"训练失败: {str(e)}"}), 500

        # 渲染
        try:
            print("开始渲染...")
            model_path = exp_path
            render(project_id=project_id, model_path=model_path, configs=configs)
            print("渲染完成")
        except Exception as e:
            print(f"渲染失败: {str(e)}")
            traceback.print_exc()
            return jsonify({"error": f"渲染失败: {str(e)}"}), 500
        
    except Exception as e:
        print(f"重建过程出错: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": f"重建失败: {str(e)}"}), 500
