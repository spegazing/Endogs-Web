#
# Copyright (C) 2023, Inria
# GRAPHDECO research group, https://team.inria.fr/graphdeco
# All rights reserved.
#
# This software is free for non-commercial, research and evaluation use 
# under the terms of the LICENSE.md file.
#
# For inquiries contact  george.drettakis@inria.fr
#

import os
from algorithms.Gaussian.utils.system_utils import searchForMaxIteration
from algorithms.Gaussian.scene.dataset_readers import sceneLoadTypeCallbacks
from algorithms.Gaussian.scene.gaussian_model import GaussianModel
from algorithms.Gaussian.scene.dataset import FourDGSdataset
from algorithms.Gaussian.arguments import ModelParams

"""
Scene 类：负责加载场景数据、管理高斯模型，并提供保存和获取相机信息的接口。
Scene 类在初始化时根据指定的路径和参数加载场景数据，并根据需要加载预训练的模型。
提供了保存当前模型状态的方法，以及获取训练、测试和视频相机信息的方法
"""
class Scene:

    gaussians : GaussianModel
    
    def __init__(self, args : ModelParams, gaussians : GaussianModel, load_iteration=None, shuffle=True, resolution_scales=[1.0], load_coarse=False):
        """b
        :param path: Path to colmap scene main folder.
        """
        self.model_path = args.model_path     # 模型保存路径
        self.loaded_iter = None               # 已加载的迭代次数
        self.gaussians = gaussians            # 高斯模型对象
        self.mode = args.mode                 # 场景模式（例如训练、测试等）

        if load_iteration:
            if load_iteration == -1:          # 如果指定了加载迭代次数为-1，则搜索最大迭代次数
                self.loaded_iter = searchForMaxIteration(os.path.join(self.model_path, "point_cloud")) 
            else:
                self.loaded_iter = load_iteration
            print("Loading trained model at iteration {}".format(self.loaded_iter))
        
        if os.path.exists(os.path.join(args.source_path, "sparse")) and args.extra_mark is None:
            scene_info = sceneLoadTypeCallbacks["Colmap"](args.source_path, args.images, args.eval) 
        elif os.path.exists(os.path.join(args.source_path, "poses_bounds.npy")) and args.extra_mark == 'endonerf':
             scene_info = sceneLoadTypeCallbacks["endonerf"](args.source_path, mode=args.mode)
        else:
            assert False, "Could not recognize scene type!"
        
        self.maxtime = scene_info.maxtime
        self.cameras_extent = scene_info.nerf_normalization["radius"]
        print("self.cameras_extent is ", self.cameras_extent)

        print("Loading Training Cameras")
        self.train_camera = scene_info.train_cameras
        print("Loading Test Cameras")
        self.test_camera = scene_info.test_cameras
        print("Loading Video Cameras")
        self.video_camera = scene_info.video_cameras
        
        xyz_max = scene_info.point_cloud.points.max(axis=0)
        xyz_min = scene_info.point_cloud.points.min(axis=0)
        self.gaussians._deformation.deformation_net.grid.set_aabb(xyz_max,xyz_min)

        if self.loaded_iter:
            iteration_str = 'iteration_'+str(self.loaded_iter) if not load_coarse else 'coarse_iteration_'+str(self.loaded_iter)
            self.gaussians.load_ply(os.path.join(self.model_path,
                                                           "point_cloud",
                                                           iteration_str,
                                                           "point_cloud.ply"))
            self.gaussians.load_model(os.path.join(self.model_path,
                                                    "point_cloud",
                                                    iteration_str,
                                                   ))
        else:
            if args.extra_mark == 'endonerf':
                self.gaussians.create_from_pcd(scene_info.point_cloud, args.camera_extent, self.maxtime)
            else:
                self.gaussians.create_from_pcd(scene_info.point_cloud, self.cameras_extent, self.maxtime)

    def save(self, iteration, stage):
        # 根据当前迭代次数和阶段（例如粗化或细化）保存高斯模型的状态，包括点云数据和变形信息
        if stage == "coarse":
            point_cloud_path = os.path.join(self.model_path, "point_cloud/coarse_iteration_{}".format(iteration))
        else:
            point_cloud_path = os.path.join(self.model_path, "point_cloud/iteration_{}".format(iteration))
        self.gaussians.save_ply(os.path.join(point_cloud_path, "point_cloud.ply"))
        self.gaussians.save_deformation(point_cloud_path)
    
    def getTrainCameras(self, scale=1.0):
        # 获取训练相机信息，可能包括位置、旋转和其他参数，供训练过程中使用
        return self.train_camera

    def getTestCameras(self, scale=1.0):
        # 获取测试相机信息，供评估过程中使用
        return self.test_camera

    def getVideoCameras(self, scale=1.0):
        # 获取视频相机信息，供生成视频或动画过程中使用
        return self.video_camera