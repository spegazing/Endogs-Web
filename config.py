import os

# 基础目录配置
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 处理目录（存放上传的视频帧等）
PROCESS_DIR = os.path.join(BASE_DIR, "data", "process")
os.makedirs(PROCESS_DIR, exist_ok=True)

# 结果目录（存放重建结果）
RESULT_DIR = os.path.join(BASE_DIR, "data", "result")
os.makedirs(RESULT_DIR, exist_ok=True)

RECONSTRUCT_DIR = os.path.join(BASE_DIR, "data", "reconstruct")
os.makedirs(RESULT_DIR, exist_ok=True)

# 模型目录
CHECKPOINTS_PATH = os.path.join(BASE_DIR, 'checkpoints')
os.makedirs(RESULT_DIR, exist_ok=True)

# 其他配置...
DEBUG = True
HOST = '0.0.0.0'
PORT = 5000

# 图像数据
IMG_WIDTH=640
IMG_HEIGHT=512

# 用户重建参数
User_coarse_iterations  = 1000
User_iteratoins = 3000
User_percent_dense = 0.01
