import argparse

from tqdm import tqdm
import cv2
import glob
import matplotlib
import numpy as np
import os
import torch
import config

from algorithms.depth_anything_v2.dpt import DepthAnythingV2

def depth_estimate(img_path, outdir, input_size=518, encoder='vitl', pred_only=False, grayscale=False):    
    DEVICE = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
    
    model_configs = {
        'vits': {'encoder': 'vits', 'features': 64, 'out_channels': [48, 96, 192, 384]},
        'vitb': {'encoder': 'vitb', 'features': 128, 'out_channels': [96, 192, 384, 768]},
        'vitl': {'encoder': 'vitl', 'features': 256, 'out_channels': [256, 512, 1024, 1024]},
        'vitg': {'encoder': 'vitg', 'features': 384, 'out_channels': [1536, 1536, 1536, 1536]}
    }
    
    depth_anything = DepthAnythingV2(**model_configs[encoder])
    depth_anything.load_state_dict(torch.load(f'{config.CHECKPOINTS_PATH}/depth_anything_v2_{encoder}.pth', map_location='cpu'))
    depth_anything = depth_anything.to(DEVICE).eval()
    
    if os.path.isfile(img_path):
        if img_path.endswith('txt'):
            with open(img_path, 'r') as f:
                filenames = f.read().splitlines()
        else:
            filenames = [img_path]
    else:
        filenames = glob.glob(os.path.join(img_path, '**/*'), recursive=True)
    
    os.makedirs(outdir, exist_ok=True)
    
    # cmap = matplotlib.colormaps.get_cmap('Spectral_r')
    cmap = matplotlib.colormaps['Spectral_r']

    for k, filename in tqdm(enumerate(filenames), desc="Processing", unit="file"):
        
        raw_image = cv2.imread(filename)
        
        depth = depth_anything.infer_image(raw_image, input_size)
        
        depth = (depth - depth.min()) / (depth.max() - depth.min()) * 255.0
        depth = depth.astype(np.uint8)
        
        if grayscale:
            depth = np.repeat(depth[..., np.newaxis], 3, axis=-1)
        else:
            depth = (cmap(depth)[:, :, :3] * 255)[:, :, ::-1].astype(np.uint8)
        
        cv2.imwrite(os.path.join(outdir, os.path.splitext(os.path.basename(filename))[0] + '.png'), depth)
        # if args.pred_only:
        #     cv2.imwrite(os.path.join(args.outdir, os.path.splitext(os.path.basename(filename))[0] + '.png'), depth)
        # else:
        #     split_region = np.ones((raw_image.shape[0], 50, 3), dtype=np.uint8) * 255
        #     combined_result = cv2.hconcat([raw_image, split_region, depth])
            
        #     cv2.imwrite(os.path.join(args.outdir, os.path.splitext(os.path.basename(filename))[0] + '.png'), combined_result)
