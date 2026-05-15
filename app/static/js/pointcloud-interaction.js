import {State} from './state.js';
import * as THREE from '../assets/js/three/build/three.module.js';
import { loadPointCloudFrame } from './reconstruct.js';

// ==========================================
// 背景渐变设置
// ==========================================
function changeBackgroundGradient() {
    const colorStart = document.getElementById('bgColorStart').value;
    const colorEnd = document.getElementById('bgColorEnd').value;

    const canvas = createGradientCanvas(colorStart, colorEnd);
    State.pointCloudScene.background = new THREE.CanvasTexture(canvas);

    // 3. 网格按钮 (UI 背景)
    // 将 Canvas 转换为 Base64 图片数据
    const backgroundImage = canvas.toDataURL('image/png'); 
    
    // 获取背景按钮元素
    const bgSetBtn = document.getElementById('bgSetBtn');
    if (bgSetBtn) {
        bgSetBtn.style.backgroundImage = `url(${backgroundImage})`;
        bgSetBtn.style.backgroundSize = '70%'; // 确保图片覆盖整个按钮
        bgSetBtn.style.backgroundPosition = 'center'; // 居中
        bgSetBtn.style.backgroundRepeat = 'no-repeat'; // 不重复
        bgSetBtn.style.backgroundColor = 'transparent'; 
    }
}

// ==========================================
// 透明背景设置
// ==========================================
function setTransparentBackground() {
    const canvas = createGradientCanvas("#ffffff", "#ffffff");
    // 使用 State 模块的 pointCloudScene
    State.pointCloudScene.background = new THREE.CanvasTexture(canvas);

    const backgroundImage = canvas.toDataURL('image/png'); 
    
    const bgSetBtn = document.getElementById('bgSetBtn');
    if (bgSetBtn) {
        bgSetBtn.style.backgroundImage = `url(${backgroundImage})`;
        bgSetBtn.style.backgroundSize = '70%'; // 确保图片覆盖整个按钮
        bgSetBtn.style.backgroundPosition = 'center'; // 居中
        bgSetBtn.style.backgroundRepeat = 'no-repeat'; // 不重复
        bgSetBtn.style.backgroundColor = 'transparent'; 
    }
}

// ==========================================
// 网格显示/隐藏切换
// ==========================================
function toggleGrid() {
    const btn = document.getElementById('gridToggleBtn');
    
    // 如果网格不存在则创建（使用 State 模块的 gridHelper）
    if (!State.gridHelper) {
        State.gridHelper = new THREE.GridHelper(50, 1000); // 参数根据你的场景调整
        State.pointCloudScene.add(State.gridHelper);
        console.log("创建并显示网格");
    } else {
        // 切换可见性
        State.gridHelper.visible = !State.gridHelper.visible;
        if (State.gridHelper.visible) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        console.log("切换网格可见性");
    }
}

// ==========================================
// 创建渐变背景画布
// ==========================================
function createGradientCanvas(color1, color2) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

// ==========================================
// 播放控制
// ==========================================
function togglePlayback() {
    // 读写 State 模块的 isPlaying
    State.isPlaying = !State.isPlaying;
        
    if (State.isPlaying) {
        startPlayback();
    } else {
        stopPlayback();
    }
}

// 开始播放
function startPlayback() {
    stopPlayback();
    
    // 读取 State 模块的 playbackSpeed
    const interval = 1000 / (5 * State.playbackSpeed);
    // 写入 State 模块的 playbackInterval
    State.playbackInterval = setInterval(() => {
        // 读取 State 模块的 currentFrameIndex 和 pointCloudFrames
        let nextFrame = State.currentFrameIndex + 1;
        if (nextFrame >= State.pointCloudFrames.length) {
            nextFrame = 0;
        }
        loadPointCloudFrame(nextFrame);
    }, interval);
}

// 停止播放
function stopPlayback() {
    // 读取 State 模块的 playbackInterval
    if (State.playbackInterval) {
        clearInterval(State.playbackInterval);
        State.playbackInterval = null;
    }
}

// 调整播放速度
function adjustSpeed(delta) {
    // 读写 State 模块的 playbackSpeed
    State.playbackSpeed = Math.max(0.2, Math.min(3.0, State.playbackSpeed + delta));
    document.getElementById('playbackSpeed').innerText = State.playbackSpeed.toFixed(1);
    
    // 读取 State 模块的 isPlaying
    if (State.isPlaying) {
        startPlayback();
    }
}

// ==========================================
// 点云缩放控制
// ==========================================
function scalePointCloud(opera) {
    // 读取 State 模块的 currentPointCloud
    if (!State.currentPointCloud) return;

    // 1. 确保几何体有包围盒（Bounding Box）
    if (!State.currentPointCloud.geometry.boundingBox) {
        State.currentPointCloud.geometry.computeBoundingBox();
    }

    // 2. 获取模型的几何中心（局部坐标系下的中心）
    const box = State.currentPointCloud.geometry.boundingBox;
    const localCenter = new THREE.Vector3();
    box.getCenter(localCenter); // 局部坐标系的中心

    // 3. 将局部中心转换为世界坐标系的中心
    const worldCenter = localCenter.clone();
    State.currentPointCloud.localToWorld(worldCenter);

    let newScale = null; 
    // 4. 计算缩放比例
    if (opera) {
        const scaleFactor = 0.3; // 缩放步长（可根据需求调整）
        const scaleMultiplier = (opera === 1) ? (1 + scaleFactor) : (1 - scaleFactor);
        const currentScale = State.currentPointCloud.scale.x;
        newScale = currentScale * scaleMultiplier;
        // 5. 限制缩放范围
        if (newScale < 0.01 || newScale > 20.0) {
            console.log('缩放已达限制');
            return;
        }
    } else {
        newScale = 1.0;    
    }
    
    // 6. 保存缩放前的位置
    const oldPosition = State.currentPointCloud.position.clone();

    // 7. 执行缩放（等比例缩放）
    State.currentPointCloud.scale.set(newScale, newScale, newScale);

    // 写入 State 模块的 lastUserScale
    State.lastUserScale = newScale;

    // 8. 补偿位置：使几何中心保持在世界坐标系的原位置
    const newWorldCenter = localCenter.clone();
    State.currentPointCloud.localToWorld(newWorldCenter); // 缩放后的新世界中心

    // 计算位置补偿量（世界坐标系下的偏移）
    const positionOffset = new THREE.Vector3().subVectors(worldCenter, newWorldCenter);

    // 调整模型位置，使几何中心回到原来的世界坐标
    State.currentPointCloud.position.add(positionOffset);

    // 9. 更新控制器（可选，若使用 OrbitControls）
    // 读取 State 模块的 pointCloudControls
    if (State.pointCloudControls) {
        State.pointCloudControls.target.copy(worldCenter); // 控制器目标指向几何中心
        State.pointCloudControls.update();
    }
}

// 重置缩放
function resetScale() {
    scalePointCloud(0);
}

// 获取当前缩放值
function getCurrentScale() {
    // 读取 State 模块的 currentPointCloud
    if (!State.currentPointCloud) return 1.0;
    return State.currentPointCloud.scale.x;
}

// 切换帧
function SwitchFrame(direction){
    State.currentFrameIndex = (State.currentFrameIndex + direction + State.pointCloudFrames.length) % State.pointCloudFrames.length;
    loadPointCloudFrame(State.currentFrameIndex);
}

// 下载所有帧到本地
function downloadAllFrames() {
    if (!State.pointCloudFrames.length) {
        alert('没有可下载的帧');
        return;
    }

    // 1. 创建 ZIP 实例
    const zip = new JSZip();
    const folder = zip.folder("point_cloud_frames"); // 在 ZIP 内创建一个文件夹
    let loadedCount = 0;
    const total = State.pointCloudFrames.length;

    console.log(`[Download] 开始打包 ${total} 个文件...`);

    // 2. 并发下载并添加到 ZIP
    State.pointCloudFrames.forEach((frameFile, index) => {
        fetch(`/get_ply_file/${State.currentProjectId}/${frameFile}`)
            .then(res => res.blob()) // 转换为 Blob
            .then(blob => {
                // 将 Blob 添加到 ZIP，保持文件名
                folder.file(frameFile, blob);
                loadedCount++;
                console.log(`[Download] 已加载 ${loadedCount}/${total}`);
                
                // 检查是否全部加载完毕
                if (loadedCount === total) {
                    generateZip();
                }
            })
            .catch(err => {
                console.error(`[Download] ${frameFile} 失败:`, err);
                loadedCount++;
                if (loadedCount === total) {
                    generateZip();
                }
            });
    });

    // 3. 生成并下载 ZIP
    function generateZip() {
        zip.generateAsync({type: "blob"}, (metadata) => {
            // 可选：更新进度
            console.log(`[Download] 打包进度: ${Math.round(metadata.percent)}%`);
        })
        .then(content => {
            // 创建下载链接
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `project_${State.currentProjectId}_frames.zip`; // 下载时的文件名
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            console.log('[Download] ✅ 下载已触发');
            alert(`✅ 成功打包并下载 ${loadedCount} 个文件！`);
        })
        .catch(err => {
            console.error('[Download] 生成 ZIP 失败:', err);
            alert('❌ 打包失败: ' + err.message);
        });
    }
}

// 导出所有需要外部调用的公开函数
export{
    downloadAllFrames,
    changeBackgroundGradient,  // 背景渐变设置
    setTransparentBackground,  // 透明背景设置
    toggleGrid,                // 网格显示/隐藏切换
    createGradientCanvas,      // 创建渐变背景画布（对外暴露便于复用）
    togglePlayback,            // 播放/暂停控制
    adjustSpeed,               // 调整播放速度
    scalePointCloud,           // 点云缩放控制
    SwitchFrame,               // 切换帧
    resetScale                 // 重置缩放
};