import warnings

warnings.filterwarnings("ignore")

import json
import os
import random
import os.path as osp

import numpy as np
from PIL import Image
from tqdm import tqdm
from algorithms.Gaussian.scene.cameras import Camera
from typing import NamedTuple
from torch.utils.data import Dataset
from algorithms.Gaussian.utils.general_utils import PILtoTorch, percentile_torch
from algorithms.Gaussian.utils.graphics_utils import getWorld2View2, focal2fov, fov2focal
import glob
from torchvision import transforms as T
import open3d as o3d
from tqdm import trange
import imageio.v2 as iio
import cv2
import torch
import fpsample
from torchvision import transforms
from dataclasses import dataclass


class CameraInfo(NamedTuple):
    uid: int
    R: np.array
    T: np.array
    FovY: np.array
    FovX: np.array
    image: np.array
    depth: np.array
    image_path: str
    image_name: str
    width: int
    height: int
    time : float
    mask: np.array
    Zfar: float
    Znear: float

class EndoNeRF_Dataset(object):
    def __init__(
        self,
        datadir,
        downsample=1.0,
        test_every=8,
        mode='binocular'
    ):
        import config
        self.img_wh = (                                # 图像宽度，图像高度
            int(config.IMG_WIDTH / downsample),
            int(config.IMG_HEIGHT / downsample),
        )
        self.root_dir = datadir                        # 数据集根目录
        self.downsample = downsample                   # 下采样因子
        self.blender2opencv = np.eye(4)                # 将Blender坐标系转换为OpenCV坐标系
        self.transform = T.ToTensor()                  # 将PIL图像转换为Tensor
        self.white_bg = False                          # 是否使用白色背景
        self.mode = mode                               # 模式

        self.load_meta()
        print(f"meta data loaded, total image:{len(self.image_paths)}")
        
        n_frames = len(self.image_paths)
        self.train_idxs = [i for i in range(n_frames) if (i-1) % test_every != 0]
        self.test_idxs = [i for i in range(n_frames) if (i-1) % test_every == 0]
        self.video_idxs = [i for i in range(n_frames)]
        
        self.maxtime = 1.0
        
    def load_meta(self):
        """
        Load meta data from the dataset.               # 加载元数据
        """
        # 加载poses
        poses_arr = np.load(os.path.join(self.root_dir, "poses_bounds.npy"))
        poses = poses_arr[:, :-2].reshape([-1, 3, 5])  # (N_cams, 3, 5)
        # 坐标变换OpenGL->Colmap, 中心poses
        H, W, focal = poses[0, :, -1]                  # 图像高度，图像宽度，焦距
        focal = focal / self.downsample                # 焦距缩放
        self.focal = (focal, focal)                    # 焦距 (f_x, f_y)
        self.K = np.array([[focal, 0 , W//2],          # 内参矩阵
                            [0, focal, H//2],
                            [0, 0, 1]]).astype(np.float32) 
        
        # poses = np.concatenate([poses[..., :1], -poses[..., 1:2], -poses[..., 2:3], poses[..., 3:4]], -1)
        poses = np.concatenate([poses[..., :1], poses[..., 1:2], poses[..., 2:3], poses[..., 3:4]], -1)

        self.image_poses = []                          # 图像poses
        self.image_times = []                          # 图像时间
        for idx in range(poses.shape[0]):
            pose = poses[idx]                                        # 相机位姿
            c2w = np.concatenate((pose, np.array([[0, 0, 0, 1]])), axis=0) # 4x4
            w2c = np.linalg.inv(c2w)                                 # 世界坐标系到相机坐标系
            R = w2c[:3, :3]                                          # 旋转矩阵
            T = w2c[:3, -1]                                          # 平移矩阵
            R = np.transpose(R)                                      # 旋转矩阵转置
            self.image_poses.append((R, T))                          # 图像poses
            self.image_times.append(idx / poses.shape[0])            # 图像时间
        
        # get paths of images, depths, masks, etc.
        agg_fn = lambda filetype: sorted(glob.glob(os.path.join(self.root_dir, filetype, "*.png"))) # 获取图像路径
        self.image_paths = agg_fn("images")          # 图像路径
        if self.mode == 'binocular':
            self.depth_paths = agg_fn("depth")       # 双目深度图像路径
        elif self.mode == 'monocular':
            self.depth_paths = agg_fn("monodepth")   # 单目深度图像路径
        else:
            raise ValueError(f"{self.mode} has not been implemented.")
        self.masks_paths = agg_fn("masks")            # 掩码路径

        assert len(self.image_paths) == poses.shape[0], "the number of images should equal to the number of poses"
        assert len(self.depth_paths) == poses.shape[0], "the number of depth images should equal to number of poses"
        assert len(self.masks_paths) == poses.shape[0], "the number of masks should equal to the number of poses"
        
    def format_infos(self, split):
        # 根据指定的训练、测试或视频分割，将图像路径、深度路径、掩码路径和相机位姿等信息格式化为Camera对象列表，以便后续的训练和评估使用
        cameras = []                                # 相机列表
        
        if split == 'train': idxs = self.train_idxs # 训练索引
        elif split == 'test': idxs = self.test_idxs # 测试索引
        else:
            idxs = self.video_idxs                  # 视频索引
        
        for idx in tqdm(idxs):
            # mask / depth
            mask_path = self.masks_paths[idx]           
            mask = Image.open(mask_path)                 
            mask = 1 - np.array(mask) / 255.0            # 掩码图像转换为0-1
            depth_path = self.depth_paths[idx]         
            if self.mode == 'binocular':
                depth = np.array(Image.open(depth_path)) 
                close_depth = np.percentile(depth[depth!=0], 3.0)
                inf_depth = np.percentile(depth[depth!=0], 99.8)
                depth = np.clip(depth, close_depth, inf_depth)
            elif self.mode == 'monocular':
                depth = np.array(Image.open(self.depth_paths[idx]))[...,0] / 255.0
                depth[depth!=0] = (1 / depth[depth!=0])*0.4
                depth[depth==0] = depth.max()
                depth = depth[...,None]
            else:
                raise ValueError(f"{self.mode} has not been implemented.")
            depth = torch.from_numpy(depth)               # 深度图像转换为Tensor
            mask = self.transform(mask).bool()            # 掩码图像转换为Tensor
            # color
            color = np.array(Image.open(self.image_paths[idx]))/255.0  # 颜色图像转换为numpy数组
            image = self.transform(color)                            # 颜色图像转换为Tensor
            # times           
            time = self.image_times[idx]                             # 时间
            # poses
            R, T = self.image_poses[idx]                             # 相机位姿
            # fov
            FovX = focal2fov(self.focal[0], self.img_wh[0])          # 水平视场角
            FovY = focal2fov(self.focal[1], self.img_wh[1])          # 垂直视场角
            # 创建CameraInfo对象
            cameras.append(Camera(colmap_id=idx,R=R,T=T,FoVx=FovX,FoVy=FovY,image=image, depth=depth, mask=mask, gt_alpha_mask=None,
                          image_name=f"{idx}",uid=idx,data_device=torch.device("cuda"),time=time,
                          Znear=None, Zfar=None))
        return cameras
    
    def get_init_pts(self, sampling='random'):
        # 根据指定的采样方法，从训练图像中获取初始点云数据，包括点云坐标、颜色和法线等信息，以便后续的模型训练使用
        if self.mode == 'binocular':
            pts_total, colors_total = [], []                     # 初始化点云列表和颜色列表
            for idx in self.train_idxs:
                color, depth, mask = self.get_color_depth_mask(idx, mode=self.mode) # 获取颜色，深度和掩码
                pts, colors, _ = self.get_pts_cam(depth, mask, color, disable_mask=False) # 获取点云，颜色和掩码
                pts = self.get_pts_wld(pts, self.image_poses[idx]) # 获取世界坐标系下的点云
                num_pts = pts.shape[0]                             # 点云数量
                if sampling == 'fps':                              # 使用fps采样
                    sel_idxs = fpsample.bucket_fps_kdline_sampling(pts, int(0.01*num_pts), h=3)
                elif sampling == 'random':                         # 使用随机采样
                    sel_idxs = np.random.choice(num_pts, int(0.01*num_pts), replace=False)
                else:
                    raise ValueError(f'{sampling} sampling has not been implemented yet.')
                pts_sel, colors_sel = pts[sel_idxs], colors[sel_idxs]  # 选择点云和颜色
                pts_total.append(pts_sel)                        # 添加点云
                colors_total.append(colors_sel)                    # 添加颜色
            pts_total = np.concatenate(pts_total)                  # 合并点云
            colors_total = np.concatenate(colors_total)            # 合并颜色
            sel_idxs = np.random.choice(pts_total.shape[0], 30_000, replace=True) # 随机选择点云
            pts, colors = pts_total[sel_idxs], colors_total[sel_idxs] # 选择点云和颜色
            normals = np.zeros((pts.shape[0], 3))                  # 初始化法线
        elif self.mode == 'monocular':
            color, depth, mask = self.get_color_depth_mask(0, mode=self.mode) # 获取颜色，深度和掩码
            pts, colors, _ = self.get_pts_cam(depth, mask, color, disable_mask=False) # 获取点云，颜色和掩码
            pts = self.get_pts_wld(pts, self.image_poses[0]) # 获取世界坐标系下的点云
            normals = np.zeros((pts.shape[0], 3))                  # 初始化法线
        
        return pts, colors, normals
        
    def get_pts_wld(self, pts, pose):
        # 根据相机位姿，将相机坐标系下的点云转换为世界坐标系下的点云，以便后续的模型训练使用
        R, T = pose                                      # 相机位姿
        R = np.transpose(R)                              # 旋转矩阵转置
        w2c = np.concatenate((R, T[...,None]), axis=-1)   # 世界坐标系到相机坐标系
        w2c = np.concatenate((w2c, np.array([[0, 0, 0, 1]])), axis=0)
        c2w = np.linalg.inv(w2c)                          # 相机坐标系到世界坐标系
        pts_cam_homo = np.concatenate((pts, np.ones((pts.shape[0], 1))), axis=-1)
        pts_wld = np.transpose(c2w @ np.transpose(pts_cam_homo))
        pts_wld = pts_wld[:, :3]                           # 世界坐标系下的点云
        return pts_wld
    
    def get_color_depth_mask(self, idx, mode):
        # 根据指定的模式，获取rgb图像、深度和掩码图像
        if mode == 'binocular':
            depth = np.array(Image.open(self.depth_paths[idx]))
            close_depth = np.percentile(depth[depth!=0], 3.0)
            inf_depth = np.percentile(depth[depth!=0], 99.8)
            depth = np.clip(depth, close_depth, inf_depth)
        else:
            depth = np.array(Image.open(self.depth_paths[idx]))[..., 0] / 255.0
            depth[depth!=0] = (1 / depth[depth!=0])*0.4
            depth[depth==0] = depth.max()

        mask = 1 - np.array(Image.open(self.masks_paths[idx]))/255.0  # 掩码图像转换为0-1
        color = np.array(Image.open(self.image_paths[idx]))/255.0     # 颜色图像转换为numpy数组
        return color, depth, mask
             
    def get_pts_cam(self, depth, mask, color, disable_mask=False):
        # 根据深度、掩码和颜色图像，获取相机坐标系下的点云坐标、颜色和掩码信息，以便后续的模型训练使用
        W, H = self.img_wh
        i, j = np.meshgrid(np.linspace(0, W-1, W), np.linspace(0, H-1, H)) # 网格化
        X_Z = (i-W/2) / self.focal[0] 
        Y_Z = (j-H/2) / self.focal[1]   
        Z = depth 
       
        X, Y = X_Z * Z, Y_Z * Z 
        pts_cam = np.stack((X, Y, Z), axis=-1).reshape(-1, 3) 
        color = color.reshape(-1, 3) 
        
        if not disable_mask:
            mask = mask.reshape(-1).astype(bool)
            pts_valid = pts_cam[mask, :]
            color_valid = color[mask, :]
        else:
            mask = mask.reshape(-1).astype(bool)
            pts_valid = pts_cam
            color_valid = color
            color_valid[mask==0, :] = np.ones(3)
                    
        return pts_valid, color_valid, mask
        
    def get_maxtime(self):
        return self.maxtime
    
@dataclass
class Intrinsics:
    # 相机内参类，包含图像宽度、高度、焦距和主点坐标等信息，并提供缩放方法以适应不同分辨率的图像输入
    width: int
    height: int
    focal_x: float
    focal_y: float
    center_x: float
    center_y: float

    def scale(self, factor: float):
        nw = round(self.width * factor)
        nh = round(self.height * factor)
        sw = nw / self.width
        sh = nh / self.height
        self.focal_x *= sw
        self.focal_y *= sh
        self.center_x *= sw
        self.center_y *= sh
        self.width = int(nw)
        self.height = int(nh)

    def __repr__(self):
        return (f"Intrinsics(width={self.width}, height={self.height}, "
                f"focal_x={self.focal_x}, focal_y={self.focal_y}, "
                f"center_x={self.center_x}, center_y={self.center_y})")
 
    def __init__(
        self,
        datadir,
        mode='binocular'
    ):  
        # basic attrs
        self.img_wh = (640, 480)
        self.root_dir = datadir
        self.transform = transforms.ToTensor()
        self.mode = mode
        
        # dummy poses
        poses = np.eye(4).astype(np.float32)
        
        # intrinsics 
        intrinsics_matrix = np.loadtxt(os.path.join(datadir, 'intrinsics.txt'))
        intrinsics = Intrinsics(
            width=self.img_wh[0], height=self.img_wh[1], focal_x=intrinsics_matrix[0,0], focal_y=intrinsics_matrix[1,1], 
            center_x=intrinsics_matrix[0,2], center_y=intrinsics_matrix[1,2])
        intrinsics.center_x = 320-0.5
        intrinsics.center_y = 240-0.5
        
        # load imgs, masks, depths
        paths_img, paths_mask, paths_depth = [], [], []
        png_cnt = 0
        str_cnt = '/000000.png'
        while os.path.exists(datadir + "/images" + str_cnt):
            paths_img.append(datadir + "/images" + str_cnt)
            paths_mask.append(datadir + "/gt_masks" + str_cnt)
            paths_depth.append(datadir + "/gt_depth" + str_cnt)
            png_cnt += 1
            str_cnt = '/' + '0' * \
                (6-len(str(png_cnt))) + str(png_cnt) + '.png'
                    
        imgs, masks, depths = self.load_from_paths(paths_img, paths_mask, paths_depth)
        
        assert len(imgs) == len(masks) == len(depths), "the number of images should equal to the number of masks and depths"
        print(f"imgs, masks, and depths loaded, total num:{len(imgs)}")
        
        imgs, masks, depths = \
            [torch.stack(lst, dim=0) for lst in [imgs, masks, depths]]
        
        # Fruther process
        # crop the images, masks and depths
        # in hamlyn dataset, we crop the image from the left side, with 40 pixels
        crop_size = 40 # a setting for hamlyn dataset
        imgs = imgs[:, :, :, crop_size:].contiguous()
        masks = masks[:, :, :, crop_size:].contiguous()
        depths = depths[:, :, :, crop_size:].contiguous()
        imgs_interp = imgs_interp[:, :, :, crop_size:].contiguous()
        masks_interp = masks_interp[:, :, :, crop_size:].contiguous()
        
        intrinsics.width = intrinsics.width - crop_size
        intrinsics.center_x = intrinsics.center_x - crop_size / 2
        # normalize depth
        close_depth = percentile_torch(depths, 3.0)
        inf_depth = percentile_torch(depths, 99.9)
        depths[depths > inf_depth] = inf_depth
        depths[depths < close_depth] = close_depth
        
        self.znear = 0.1
        self.zfar = 1.1 * inf_depth
        
        # timestamps
        timestamps = np.arange(len(imgs)).astype(np.float32) / len(imgs)
        
        # train/test split
        idxs = np.arange(len(imgs))
        self.train_idxs = idxs[::2]
        self.test_idxs = idxs[1::2]
        self.video_idxs = idxs
        
        # self assignment
        self.imgs = imgs
        self.imgs_interp = imgs_interp
        self.masks = masks
        self.masks_interp = masks_interp    
        self.inf_depth = inf_depth
        self.close_depth = close_depth 
        self.depths = depths
        self.poses = np.repeat(poses[None], len(imgs), axis=0)
        self.intrinsics = intrinsics
        self.timestamps = timestamps
        self.maxtime = 1.0
        self.crop_size = crop_size
           
    def load_from_paths(self, paths_img, paths_mask, paths_depth):
        imgs, masks, depths = [], [], []
        
        for path_img, path_mask, path_depth in zip(paths_img, paths_mask, paths_depth):
            # images
            img = Image.open(path_img).convert('RGB')
            img = img.resize((self.img_wh[0], self.img_wh[1]), Image.LANCZOS)
            img = self.transform(img) # [C, H, W]
            # masks
            mask = Image.open(path_mask).convert('L')
            mask = mask.resize((self.img_wh[0], self.img_wh[1]), Image.LANCZOS)
            mask = ~ self.transform(mask).bool() # 0 for tool, 1 for tissue
            # depths
            depth = Image.open(path_depth)
            depth = depth.resize((self.img_wh[0], self.img_wh[1]), Image.LANCZOS)
            depth = np.array(depth)
            depth = torch.from_numpy(depth).float().unsqueeze(0)
            
            imgs.append(img)
            masks.append(mask)
            depths.append(depth)
        
        return imgs, masks, depths
        
    def format_infos(self, split):
        cameras = []
        
        if split == 'train': idxs = self.train_idxs
        elif split == 'test': idxs = self.test_idxs
        elif split == 'video':
            idxs = self.video_idxs
        else:
            raise ValueError(f"{split} has not been implemented.")
        
        intrinsics = self.intrinsics
        focal_x, focal_y = intrinsics.focal_x, intrinsics.focal_y
        fov_x, fov_y = focal2fov(focal_x, intrinsics.width), focal2fov(focal_y, intrinsics.height)
            
        for idx in idxs:
            image = self.imgs[idx]
            mask = self.masks[idx]
            depth = self.depths[idx]
            time = self.timestamps[idx]
            pose = self.poses[idx]
            R, T = pose[:3, :3], pose[:3, -1]
            R = R.transpose()
            cameras.append(Camera(colmap_id=idx,R=R,T=T,FoVx=fov_x,FoVy=fov_y,
                                image=image, depth=depth, mask=mask, gt_alpha_mask=None,
                                image_name=f"{idx}",uid=idx,data_device=torch.device("cuda"),time=time,
                                Znear=self.znear, Zfar=self.zfar))
                        
        return cameras
    
    def get_init_pts(self):
        if self.mode == 'binocular':
            
            initial_idx = self.train_idxs[0]
            color, depth, mask = self.imgs[initial_idx].numpy(), self.depths[initial_idx].numpy(), self.masks[initial_idx].numpy()
            pts, colors, _ = self.get_pts_cam(depth, mask, color)
            pts = self.get_pts_wld(pts, self.poses[initial_idx])
            idxs = np.random.choice(np.arange(pts.shape[0]), 30000, replace=False)
            pts = pts[idxs, :]
            colors = colors[idxs, :]
            normals = np.zeros((pts.shape[0], 3))
        else:
            raise ValueError(f"{self.mode} has not been implemented.")
        return pts, colors, normals
    
    def get_pts_cam(self, depth, mask, color):
        # import pdb; pdb.set_trace()
        W, H = self.intrinsics.width, self.intrinsics.height
        i, j = np.meshgrid(np.linspace(0, W-1, W), np.linspace(0, H-1, H))
        X_Z = (i-W/2) / self.intrinsics.focal_x
        Y_Z = (j-H/2) / self.intrinsics.focal_y
        Z = depth
        X, Y = X_Z * Z, Y_Z * Z
        pts_cam = np.stack((X, Y, Z), axis=-1).reshape(-1, 3)
        color = color.reshape(-1, 3)
        mask = mask.transpose(2, 0, 1).reshape(-1).astype(bool)
        valid_region = (np.abs(pts_cam).sum(axis=-1)!=0)
        mask = np.logical_and(mask, valid_region)
        pts_valid = pts_cam[mask, :]
        color_valid = color[mask, :]

        return pts_valid, color_valid, mask
    
    def get_pts_wld(self, pts, pose):
        R, T = pose[:3, :3], pose[:3, -1]
        R = R.transpose()
        w2c = np.concatenate((R, T[...,None]), axis=-1)
        w2c = np.concatenate((w2c, np.array([[0, 0, 0, 1]])), axis=0)
        c2w = np.linalg.inv(w2c)
        pts_cam_homo = np.concatenate((pts, np.ones((pts.shape[0], 1))), axis=-1)
        pts_wld = np.transpose(c2w @ np.transpose(pts_cam_homo))
        pts_wld = pts_wld[:, :3]
        return pts_wld