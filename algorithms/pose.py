import numpy as np
import os
from PIL import Image

def process_posesbound(scenedir):
    # 1. video folder
    image_dir = os.path.join(scenedir, "images")
    output_path = os.path.join(scenedir, "poses_bounds.npy")

    # 2. retrieve image list
    image_files = sorted([f for f in os.listdir(image_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))])
    num_images = len(image_files)

    if num_images == 0:
        print(f"Error: No image files found in {image_dir}.")
    else:
        # 3. get image resolution
        with Image.open(os.path.join(image_dir, image_files[0])) as img:
            width, height = img.size
        
        # 4. set parameters
        # focal length (f) can be set to about 1.2 * width by default, or adjusted from camera params
        focal = width * 1.2 
        # near and far plane depths
        near, far = 0.1, 100.0

        # 5. construct LLFF-format 3x5 pose matrix [R | T | H W f]
        # R (rotation) is identity, T (translation) is zero, final column is [H, W, f]
        identity_pose = np.array([
            [1, 0, 0, 0, height],
            [0, 1, 0, 0, width],
            [0, 0, 1, 0, focal]
        ]).flatten() # flatten to 15-d vector

        # 6. concatenate pose with bounds to form a 17-d vector (15 + 2)
        pose_entry = np.concatenate([identity_pose, [near, far]])

        # 7. repeat this vector for all images to form an (N, 17) matrix
        poses_bounds = np.tile(pose_entry, (num_images, 1))

        # 8. save file
        np.save(output_path, poses_bounds)
        print(f"Success: Generated identity pose file {output_path} for {num_images} images")
    