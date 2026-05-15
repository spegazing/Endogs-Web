from tqdm import tqdm
import cv2
import os
import re
from PIL import Image  
import glob
from pathlib import Path
import numpy as np

def extract_frames(video_path, output_dir, frame_prefix="frame", image_extension=".png"):
    """
    Split a video file into individual frame images.
    """
    # Check if the input file exists
    if not os.path.exists(video_path):
        print(f"Error: Video file not found: {video_path}")
        return
    
    # Create the output directory
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Created output directory: {output_dir}")
    # save jpg images for sam
    jpg_img_dir = os.path.join(os.path.dirname(output_dir), 'jpg_images')
    os.makedirs(jpg_img_dir, exist_ok=True)

    # Attempt to open the video file
    vidcap = cv2.VideoCapture(video_path)
    if not vidcap.isOpened():
        print(f"Error: Could not open video file {video_path}. Check file permissions or format.")
        return

    total_frames = int(vidcap.get(cv2.CAP_PROP_FRAME_COUNT))
    progress_bar = tqdm(total=total_frames, desc="Extracting frames", unit="frame")
    frame_count = 0

    while True:
        # Read frame by frame
        success, image = vidcap.read()
        if not success:
            break

        # --- 新增：等比例缩放逻辑 ---
        h, w = image.shape[:2]
        if w > 700:
            new_w = 768
            # 计算缩放比例并计算新高度
            scale = new_w / w
            new_h = int(h * scale)
            # 执行缩放，建议使用 INTER_AREA (缩小) 或 INTER_LINEAR (放大)
            image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
        # -------------------------

        # Construct output filename (using five-digit zero padding, e.g., 00000)
        frame_filename = f"{frame_count:05d}{image_extension}"
        jpg_frame_filename = f"{frame_count:05d}{'.jpg'}"

        output_path = os.path.join(output_dir, frame_filename)
        jpg_img_path = os.path.join(jpg_img_dir, jpg_frame_filename)

        cv2.imwrite(jpg_img_path, image, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        cv2.imwrite(output_path, image)

        # update the progress_bar
        progress_bar.update(1)
        frame_count += 1

    # Colse the progess_bar and release resources
    progress_bar.close()
    vidcap.release()

    print(f"\nSuccess: {frame_count} frames extracted to {output_dir}")

def apply_mask_to_depth(mask_dir, depth_dir, out_dir):
    """
    Apply mask to depth
    """
    os.makedirs(out_dir, exist_ok=True)

    depth_files = sorted([
        f for f in os.listdir(depth_dir)
        if f.endswith(".png")
    ])

    for fname in tqdm(depth_files):
        depth_path = os.path.join(depth_dir, fname)
        mask_path  = os.path.join(mask_dir, fname)
    
        # If there is no corresponding mask, skip.
        if not os.path.exists(mask_path):
            print(f"[WARNING] \"mask\" does not exist.: {fname}")
            continue

        depth = cv2.imread(depth_path, cv2.IMREAD_UNCHANGED)
        mask  = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)

        if depth is None or mask is None:
            print(f"[WARN] Read failure: {fname}")
            continue
        if depth.shape[:2] != mask.shape[:2]:
            print(f"[WARN] Inconsistent sizes: {fname}")
            continue

        # Set as the minimum depth
        depth_modified = depth.copy()
        depth_modified[mask > 0] = 0

        out_path = os.path.join(out_dir, fname)
        cv2.imwrite(out_path, depth_modified)

def Modify_Image_Extension(src_extension=".png", dest_extension=".jpg", path=None):
    """
    modify the image extension in a directory, and delete the original image
    """
    if path is None:
        print("Error: Please provide a valid path")
        return 
    for file in os.listdir(path):
        if file.endswith(src_extension):
            full_path = os.path.join(path, file)
            # 1. Convert and save as jpg
            img = Image.open(full_path).convert("RGB")
            new_file_path = os.path.join(path, file.replace(f".{src_extension}", f".{dest_extension}"))
            img.save(new_file_path)
            
            # 2. Delete the original PNG image
            os.remove(full_path) 
            print(f"Conversion completed and deleted: {file}")

def convert_depth_to_single_channel(depth_dir, output_dir):
    """
    Convert 3-channel depth images to single-channel (grayscale) and save them.
    """
    os.makedirs(output_dir, exist_ok=True)

    depth_files = sorted(glob.glob(os.path.join(depth_dir, "*.png")))
    
    for depth_file in tqdm(depth_files, desc="Converting depth images", unit="image"):
        # read rgb image
        depth_rgb = cv2.imread(depth_file)
        # color2gray
        depth_single = cv2.cvtColor(depth_rgb, cv2.COLOR_BGR2GRAY)
        output_path = os.path.join(output_dir, os.path.basename(depth_file))
        cv2.imwrite(output_path, depth_single)

def depth_invert(input_path, output_path):
    """
    Invert the depth values in a directory of depth images with a progress bar.
    """
    # 1. 检查输入路径是否存在
    if not os.path.exists(input_path):
        print(f"Error: Input path '{input_path}' does not exist.")
        return

    # 2. 创建输出目录
    os.makedirs(output_path, exist_ok=True)

    # 3. 预先获取所有符合条件的文件名，用于计算总数
    filenames = [f for f in os.listdir(input_path) if f.lower().endswith('.png')]
    total_files = len(filenames)

    if total_files == 0:
        print(f"No PNG images found in {input_path}")
        return

    print(f"Inverting {total_files} depth images...")

    # 4. 使用 tqdm 包装循环
    count = 0
    for filename in tqdm(filenames, desc="Inverting", unit="img"):
        img_path = os.path.join(input_path, filename)
        
        # 使用 IMREAD_UNCHANGED 保持原始位深 (8-bit 或 16-bit)
        img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
        
        if img is None:
            # tqdm 环境下建议使用 tqdm.write 避免破坏进度条
            tqdm.write(f"Unable to read the file: {filename}")
            continue

        # 5. 反转深度值逻辑
        if img.dtype == np.uint8:
            inverted_img = 255 - img
        elif img.dtype == np.uint16:
            inverted_img = 65535 - img
        else:
            # 通用处理：获取该数据类型的最大可能值
            max_val = np.iinfo(img.dtype).max
            inverted_img = max_val - img

        # 6. 保存结果
        cv2.imwrite(os.path.join(output_path, filename), inverted_img)
        count += 1

    print(f"\nProcessing completed! A total of {count} images converted.")
    print(f"Saved to: {output_path}")

def resize_images(input_folder, output_folder, target_size=(640, 512)):
    """
    Resizes all images in the input folder to the target size and saves them to the output folder.
    """
    # 1. Path validation and folder creation
    if not os.path.exists(input_folder):
        print(f"Error: Input folder '{input_folder}' not found.")
        return

    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
        print(f"Created output folder: {output_folder}")

    # 2. Filter image files
    valid_extensions = ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff')
    filenames = [f for f in os.listdir(input_folder) if f.lower().endswith(valid_extensions)]
    
    if not filenames:
        print(f"No valid images found in {input_folder}")
        return

    print(f"Resizing {len(filenames)} images to {target_size}...")

    # 3. Process images with progress bar
    for filename in tqdm(filenames, desc="Resizing", unit="img"):
        input_filepath = os.path.join(input_folder, filename)
        output_filepath = os.path.join(output_folder, filename)

        try:
            with Image.open(input_filepath) as img:
                # Use BILINEAR resampling for balanced quality and performance
                # For depth maps, Image.Resampling.NEAREST is often preferred to keep exact values
                img_resized = img.resize(target_size, Image.Resampling.BILINEAR)
                img_resized.save(output_filepath)
        except Exception as e:
            tqdm.write(f"Error occurred while processing {filename}: {e}")

    print(f"\nSuccess: Resizing complete. Images saved to {output_folder}")