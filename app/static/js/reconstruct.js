import * as THREE from '../assets/js/three/build/three.module.js';
import { TrackballControls } from '../assets/js/three/examples/jsm/controls/TrackballControls.js';
import { State } from './state.js'; // 请确保正确引入 State 模块
import {switchPreviewTab} from "./utils.js"


function startReconstruction() {
    console.log('=== startReconstruction called ===');
    console.log('currentProjectId:', State.currentProjectId);
    
    if (!State.currentProjectId) {
        alert('请先上传项目并完成掩码/深度处理');
        return;
    }

    // 构建发送给后端的数据包
    const data = {
        project_id: State.currentProjectId,
        // 将参数传递给后端
        coarse_iterations: State.coarseVal,
        iterations: State.iterVal,
        percent_dense: State.denseVal
    };
    
    
    // 获取 DOM 元素 (重建进度条)
    const wrapper = document.getElementById('reconstructProgressWrapper');
    const bar = document.getElementById('reconstructProgressBar');
    const status = document.getElementById('reconstructStatus');
    const btn = document.getElementById('reconstructBtn');
    
    // 初始化重建进度条 UI
    if (wrapper) wrapper.style.display = 'block';
    if (bar) {
        bar.style.width = '0%';
        bar.innerText = '0%';
        bar.classList.remove('bg-success'); 
        bar.classList.add('progress-bar-striped', 'progress-bar-animated');
    }
    if (btn) btn.disabled = true;
    if (status) status.innerHTML = '⏳ 开始重建...';
    
    console.log('Sending reconstruct request...');
    
    fetch('/reconstruct', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    })
    .then(res => {
        console.log('Reconstruct response status:', res.status);
        return res.json();
    })
    .then(reconstructData => {
        console.log('Reconstruct response data:', reconstructData);
        
        if (reconstructData.error) {
            if (status) status.innerHTML = `<span style="color:red">❌ ${reconstructData.error}</span>`;
            if (btn) btn.disabled = false;
            if (wrapper) wrapper.style.display = 'none';
            return;
        }
        
        // 1. 更新重建进度条为完成状态
        if (bar) {
            bar.style.width = '100%';
            bar.innerText = '100%';
            bar.classList.remove('progress-bar-striped', 'progress-bar-animated');
            bar.classList.add('bg-success');
        }
        if (status) status.innerHTML = `<span style="color:green">✅ 重建完成！正在预加载点云数据...</span>`;


        // 1. 获取悬浮元素
        const floatingMetrics = document.getElementById('floatingMetrics');
        
        // 2. 填充数据并显示
        if (floatingMetrics) {
            // 保留合适的小数位数
            document.getElementById('val-ssim').innerText = reconstructData.SSIM.toFixed(3);
            document.getElementById('val-psnr').innerText = reconstructData.PSNR.toFixed(3);
            document.getElementById('val-lpips').innerText = reconstructData.LPIPS.toFixed(3);
            document.getElementById('val-flip').innerText = reconstructData.FLIP.toFixed(3);
            
            floatingMetrics.style.display = 'block'; // 显示悬浮框
        }

        
        // 2. 【关键】先获取文件列表，确保 State.pointCloudFrames 有数据
        return fetch(`/get_ply_frames/${State.currentProjectId}`)
            .then(res => res.json())
            .then(listData => {
                State.pointCloudFrames = listData.frames || [];
                State.total_FrameCount = State.pointCloudFrames.length;
                document.getElementById('totalFrames').innerText = State.pointCloudFrames.length;
                
                console.log(`[Info] 获取到 ${State.pointCloudFrames.length} 个帧，开始加载到内存...`);
                
                // A. 切换到点云标签页
                switchPreviewTab('pointcloud');

                // 3. 调用加载函数
                // 注意：这里传入的回调不再包含 confirm，而是直接显示点云
                load_AllFrames2Memory(State.pointCloudFrames.length, () => {
                    console.log('[Callback] 所有数据加载完毕，准备显示点云...');
                    
                    // 延迟一小会儿确保 DOM 和状态更新
                    setTimeout(() => {
                        
                        
                        // B. 如果视图未初始化，则初始化
                        if (!State.pointCloudInitialized && State.pointCloudFrames.length > 0) {
                            initPointCloudViewer();
                        }
                        
                        // C. 加载并渲染第一帧
                        if (State.pointCloudFrames.length > 0) {
                            // 确保容器尺寸正确后再加载
                            setTimeout(() => {
                                loadPointCloudFrame(0);
                                console.log('✅ 点云已自动显示');
                                
                                // 重置重建按钮状态
                                if (btn) btn.disabled = false;
                                if (wrapper) wrapper.style.display = 'none';
                                if (status) status.innerHTML = '<span style="color:#6c757d">✔️ 重建与加载已完成</span>';
                            }, 100);
                        }
                    }, 300);
                });
            });
    })
    .catch(err => {
        console.error('Fetch error:', err);
        if (status) status.innerHTML = `<span style="color:red">❌ 操作失败: ${err.message}</span>`;
        if (btn) btn.disabled = false;
        if (wrapper) wrapper.style.display = 'none';
    });
}

function load_AllFrames2Memory(plycount, onComplete) {
    // 防御性检查
    if (!State.pointCloudFrames.length || State.allFramesLoaded) {
        console.log('[Cache] 所有帧已加载或无帧可加载');
        if (onComplete) onComplete();
        return;
    }
    
    const total = plycount;
    let loaded = 0;
    
    console.log(`[Cache] 开始并发下载 ${total} 帧...`);
    
    // 1. 获取圆形加载条元素
    const loader = document.getElementById('pointCloudLoader');
    const progressRing = document.getElementById('progressRing');
    const loaderText = document.getElementById('loaderText');
    
    // 2. 显示加载条并初始化
    if (loader) loader.style.display = 'flex';
    if (loaderText) {
        loaderText.innerText = '正在加载点云数据... 0%';
        loaderText.style.color = '#333';
    }
    if (progressRing) {
        progressRing.style.background = `conic-gradient(#0d6efd 0%, #e0e0e0 0%)`;
    }

    const concurrencyLimit = 5; // 并发数
    let currentIndex = 0;
    
    function downloadNext() {
        if (currentIndex >= total) return;
        
        const index = currentIndex++;
        
        // 边界检查
        if (index >= State.pointCloudFrames.length) {
            loaded++;
            updateProgress();
            checkComplete();
            downloadNext();
            return;
        }

        const frameFile = State.pointCloudFrames[index];
        
        // 检查缓存
        if (State.pointCloudCache.has(frameFile)) {
            loaded++;
            updateProgress();
            checkComplete();
            downloadNext();
            return;
        }
        
        fetch(`/get_ply_file/${State.currentProjectId}/${frameFile}`)
            .then(res => {
                if (!res.ok) throw new Error('Network response was not ok');
                return res.arrayBuffer();
            })
            .then(buffer => {
                const result = parsePLY(buffer);
                if (result) {
                    State.pointCloudCache.set(frameFile, result);
                    updateCacheStatus(); 
                }
                loaded++;
                updateProgress();
                checkComplete();
                downloadNext();
            })
            .catch(err => {
                console.error(`[Cache] 帧 ${index} 下载失败:`, err);
                loaded++; // 即使失败也计数，防止死锁
                updateProgress();
                checkComplete();
                downloadNext();
            });
    }
    
    function updateProgress() {
        const percent = Math.min(100, Math.round((loaded / total) * 100));
        if (progressRing) {
            // 动态更新圆环进度
            progressRing.style.background = `conic-gradient(#0d6efd ${percent}%, #e0e0e0 ${percent}% 100%)`;
        }
        if (loaderText) {
            loaderText.innerText = `正在加载点云数据... ${loaded}/${total} (${percent}%)`;
        }
    }
    
    function checkComplete() {
        if (loaded >= total) {
            State.allFramesLoaded = true;
            console.log('[Cache] ✅ 所有帧加载完成！');
            
            // 视觉反馈：填满圆环，文字变绿
            if (progressRing) {
                progressRing.style.background = `conic-gradient(#0d6efd 100%, #e0e0e0 100%)`;
            }
            if (loaderText) {
                loaderText.innerText = '✅ 加载完成！正在渲染...';
                loaderText.style.color = '#198754';
            }

            // 短暂延迟后隐藏加载条并执行回调（显示点云）
            setTimeout(() => {
                if (loader) loader.style.display = 'none';
                // 重置文字状态
                if (loaderText) {
                    loaderText.style.color = '#333';
                    loaderText.innerText = '正在加载点云数据... 0%';
                }
                
                // 执行主流程回调
                if (typeof onComplete === 'function') {
                    onComplete();
                }
            }, 600);
        }
    }

    // 启动并发下载
    for (let i = 0; i < Math.min(concurrencyLimit, total); i++) {
        downloadNext();
    }
}

// ========== 点云加载和显示函数 ==========
function loadPointCloudFrames() {
    fetch(`/get_ply_frames/${State.currentProjectId}`)
        .then(res => res.json())
        .then(data => {
            State.pointCloudFrames = data.frames || [];
            State.total_FrameCount = State.pointCloudFrames.length;
            document.getElementById('totalFrames').innerText = State.pointCloudFrames.length;
            
            if (State.pointCloudFrames.length > 0) {
                initPointCloudViewer();
                setTimeout(() => {
                    loadPointCloudFrame(0);
                }, 50);
            }
        })
        .catch(err => console.error('Failed to load point cloud frames:', err));
}


// 更新加载状态显示
function updateCacheStatus() {
    const cacheStatusEl = document.getElementById('cacheStatus');
    if (!cacheStatusEl) return;
    
    const cachedCount = State.pointCloudCache.size;
    const totalCount = State.pointCloudFrames.length;
    
    if (totalCount === 0) {
        cacheStatusEl.innerText = '';
        return;
    }
    
    if (State.allFramesLoaded) {
        cacheStatusEl.innerText = '✅ 全部已加载';
        cacheStatusEl.style.color = 'green';
    } else if (cachedCount > 0) {
        cacheStatusEl.innerText = `📦 已加载 ${cachedCount}/${totalCount}`;
        cacheStatusEl.style.color = '#17a2b8';
    } else {
        cacheStatusEl.innerText = '⚠️ 未加载';
        cacheStatusEl.style.color = '#dc3545';
    }
}



// 初始化点云视图
function initPointCloudViewer() {
    if (State.pointCloudInitialized) {
        console.log("[Viewer] 已初始化，跳过加载");
        return; 
    }

    const container = document.getElementById('pointCloudViewer');
    if (!container) {
        console.error("❌ 找不到 pointCloudViewer 容器！");
        return;
    }

    const rect = container.getBoundingClientRect();
    console.log(`[Debug] 容器尺寸：宽=${rect.width}, 高=${rect.height}`);
    if (rect.width === 0 || rect.height === 0) {
        container.style.width = '100%';
        container.style.height = '600px';
        container.style.display = 'block';
    }

    console.log('Initializing point cloud viewer with TrackballControls...');
    
    // 1. 场景
    State.pointCloudScene = new THREE.Scene();
    const gradientCanvas = createGradientCanvas('#ffffff', '#5A96C8'); 
    State.pointCloudScene.background = new THREE.CanvasTexture(gradientCanvas);

    // 2. 相机
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    State.pointCloudCamera = new THREE.PerspectiveCamera(45, width / height, 0.001, 10000);
    State.pointCloudCamera.position.set(0, 0, 5); 

    // 3. 渲染器
    State.pointCloudRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    State.pointCloudRenderer.setSize(width, height);
    State.pointCloudRenderer.setPixelRatio(window.devicePixelRatio);
    State.pointCloudRenderer.setClearColor(0xe5dfdf, 1);
    
    // 兼容新旧版本的色彩空间设置
    State.pointCloudRenderer.outputEncoding = THREE.sRGBEncoding;

    container.innerHTML = ''; 
    container.appendChild(State.pointCloudRenderer.domElement);

    const canvasEl = State.pointCloudRenderer.domElement;
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    canvasEl.style.display = 'block';

    // 4. 使用 TrackballControls
    State.pointCloudControls = new TrackballControls(State.pointCloudCamera, canvasEl);
    State.pointCloudControls.enableDamping = true;
    State.pointCloudControls.dampingFactor = 0.15; // TrackballControls 的 damping 更敏感
    State.pointCloudControls.rotateSpeed = 2.0;
    State.pointCloudControls.zoomSpeed = 1.2;
    State.pointCloudControls.panSpeed = 0.8;

    // 注意：TrackballControls 没有 minDistance/maxDistance
    // 5. 光照
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    State.pointCloudScene.add(ambientLight);

    // 6. 动画循环
    animatePointCloud();
    window.addEventListener('resize', onPointCloudResize);

    State.pointCloudInitialized = true;
    console.log("[Viewer] 初始化完成（TrackballControls）");
}

// ========== 修改 animatePointCloud ==========
function animatePointCloud() {
    requestAnimationFrame(animatePointCloud);
    
    if (State.pointCloudControls) State.pointCloudControls.update(); // TrackballControls 需要 update()
    if (State.pointCloudRenderer && State.pointCloudScene && State.pointCloudCamera) {
        State.pointCloudRenderer.render(State.pointCloudScene, State.pointCloudCamera);
    }
}

function onPointCloudResize() {
    const container = document.getElementById('pointCloudViewer');
    if (container && State.pointCloudCamera && State.pointCloudRenderer) {
        State.pointCloudCamera.aspect = container.clientWidth / container.clientHeight;
        State.pointCloudCamera.updateProjectionMatrix();
        State.pointCloudRenderer.setSize(container.clientWidth, container.clientHeight);
    }
}

function loadPointCloudFrame(index) {
    if (!State.pointCloudFrames.length || index >= State.pointCloudFrames.length) return;
    
    const frameFile = State.pointCloudFrames[index];
    State.currentFrameIndex = index;
    
    document.getElementById('currentFrame').innerText = index;
    
    // 优先从加载读取
    if (State.pointCloudCache.has(frameFile)) {
        console.log(`[Cache] 命中加载：帧 ${index}`);
        const cachedData = State.pointCloudCache.get(frameFile);
        
        updatePointCloud(cachedData.positions, cachedData.colors, cachedData.stats, false);
        
        return;
    }
    
    // 加载未命中，从服务器加载
    console.log(`[Network] 从服务器加载帧 ${index}: ${frameFile}`);
    
    fetch(`/get_ply_file/${State.currentProjectId}/${frameFile}`)
    .then(res => res.arrayBuffer())
    .then(buffer => {
        const result = parsePLY(buffer);

        if (!result) {
            console.error("PLY 解析失败");
            return;
        }

        // 存入加载
        State.pointCloudCache.set(frameFile, result);
        console.log(`[Cache] 已加载帧 ${index}`);
        
        updatePointCloud(result.positions, result.colors, result.stats, false);
        
    })
    .catch(err => console.error('Failed to load PLY file:', err));
}

// PLY解析函数
function parsePLY(buffer) {
    const uint8 = new Uint8Array(buffer);
    const view = new DataView(buffer);
    
    let headerEnd = 0;
    const headerText = new TextDecoder().decode(uint8.slice(0, 4096));
    const lines = headerText.split(/[\r\n]+/);
    
    let vertexCount = 0;
    let isLittleEndian = true;
    let formatFound = false;
    const properties = []; 
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === 'end_header') {
            const index = headerText.indexOf('end_header');
            headerEnd = index + 'end_header'.length;
            if (uint8[headerEnd] === 10) headerEnd += 1;
            else if (uint8[headerEnd] === 13) {
                headerEnd += 1;
                if (uint8[headerEnd] === 10) headerEnd += 1;
            }
            break;
        }
        
        if (line.startsWith('format')) {
            const parts = line.split(/\s+/);
            if (parts[1] === 'binary_little_endian') isLittleEndian = true;
            else if (parts[1] === 'binary_big_endian') isLittleEndian = false;
            formatFound = true;
        }
        
        if (line.startsWith('element vertex')) {
            vertexCount = parseInt(line.split(/\s+/)[2]);
        }
        
        if (line.startsWith('property')) {
            const parts = line.split(/\s+/);
            const type = parts[1];
            const name = parts[2];
            
            let byteSize = 0;
            if (type === 'double' || type === 'd') byteSize = 8;
            else if (type === 'float' || type === 'f') byteSize = 4;
            else if (type === 'int' || type === 'i' || type === 'int32') byteSize = 4;
            else if (type === 'uint' || type === 'u' || type === 'uint32') byteSize = 4;
            else if (type === 'short' || type === 'h' || type === 'int16') byteSize = 2;
            else if (type === 'ushort' || type === 'H' || type === 'uint16') byteSize = 2;
            else if (type === 'uchar' || type === 'C' || type === 'uint8') byteSize = 1;
            else if (type === 'char' || type === 'c' || type === 'int8') byteSize = 1;
            else {
                console.warn(`未知属性类型：${type}，假设为 4 字节`);
                byteSize = 4;
            }
            
            properties.push({ name, type, size: byteSize, offset: currentOffset });
            currentOffset += byteSize;
        }
    }

    if (!formatFound || vertexCount === 0) {
        console.error("无效的 PLY 文件头");
        return null;
    }

    console.log(`[解析] 点数：${vertexCount}, 字节序：${isLittleEndian ? 'LE' : 'BE'}, 单顶点字节数：${currentOffset}`);

    const propX = properties.find(p => p.name === 'x');
    const propY = properties.find(p => p.name === 'y');
    const propZ = properties.find(p => p.name === 'z');
    const propR = properties.find(p => p.name === 'red' || p.name === 'r');
    const propG = properties.find(p => p.name === 'green' || p.name === 'g');
    const propB = properties.find(p => p.name === 'blue' || p.name === 'b');

    if (!propX || !propY || !propZ) {
        console.error("❌ 未找到 x, y, z 坐标属性!");
        return null;
    }

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    let validCount = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < vertexCount; i++) {
        const byteOffset = headerEnd + (i * currentOffset);
        
        const readValue = (prop) => {
            if (!prop) return 0;
            const off = byteOffset + prop.offset;
            if (off + prop.size > buffer.byteLength) return 0;
            
            try {
                switch (prop.type) {
                    case 'double': case 'd': return view.getFloat64(off, isLittleEndian);
                    case 'float': case 'f': return view.getFloat32(off, isLittleEndian);
                    case 'int': case 'i': case 'int32': return view.getInt32(off, isLittleEndian);
                    case 'uint': case 'u': case 'uint32': return view.getUint32(off, isLittleEndian);
                    case 'short': case 'h': case 'int16': return view.getInt16(off, isLittleEndian);
                    case 'ushort': case 'H': case 'uint16': return view.getUint16(off, isLittleEndian);
                    case 'uchar': case 'C': case 'uint8': return view.getUint8(off);
                    case 'char': case 'c': case 'int8': return view.getInt8(off);
                    default: return 0;
                }
            } catch (e) { return 0; }
        };

        let x = readValue(propX);
        let y = readValue(propY);
        let z = readValue(propZ);

        const MAX_VALID_COORD = 10000.0; 
        
        if (Math.abs(x) > MAX_VALID_COORD || Math.abs(y) > MAX_VALID_COORD || Math.abs(z) > MAX_VALID_COORD) {
            x = 0; y = 0; z = 0;
        } else {
            validCount++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        let r = 1.0, g = 1.0, b = 1.0;
        if (propR && propG && propB) {
            r = readValue(propR);
            g = readValue(propG);
            b = readValue(propB);
            
            if (propR.size === 1) { r /= 255.0; g /= 255.0; b /= 255.0; }
            else if (propR.size === 2) { r /= 65535.0; g /= 65535.0; b /= 65535.0; }
        }
        // 解决颜色褪色：PLY(sRGB)→转换 Linear→Three.js 渲染→输出 sRGB
        colors[i * 3] = Math.pow(r, 2.2);
        colors[i * 3 + 1] = Math.pow(g, 2.2);
        colors[i * 3 + 2] = Math.pow(b, 2.2);
    }

    console.log(`[完成] 有效点：${validCount} / ${vertexCount}`);

    return { positions, colors, stats: { minX, maxX, minY, maxY, minZ, maxZ, validCount } };
}

// updatePointCloud 函数
function updatePointCloud(positions, colors, stats) {
    console.group("🔍 [DEBUG] 更新点云");
    
    if (!positions || positions.length === 0) {
        console.error("❌ 位置数据为空");
        console.groupEnd();
        return;
    }

    if (!State.pointCloudScene || !State.pointCloudCamera || !State.pointCloudRenderer) {
        console.error("❌ Three.js 环境未初始化");
        console.groupEnd();
        return;
    }

    const vertexCount = positions.length / 3;

    // 1. 清理旧模型
    if (State.currentPointCloud) {
        State.pointCloudScene.remove(State.currentPointCloud);
        if (State.currentPointCloud.geometry) State.currentPointCloud.geometry.dispose();
        if (State.currentPointCloud.material) State.currentPointCloud.material.dispose();
        State.currentPointCloud = null;
    }

    // 2. 创建几何体
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // 计算包围盒，用于确定点的大小和相机距离
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const safeMaxDim = maxDim < 0.001 ? 1.0 : maxDim;

    // 3. 创建材质
    const material = new THREE.PointsMaterial({
        size: 0.0001,
        vertexColors: true,
        sizeAttenuation: true,  // 尺寸衰减
        transparent: false,     // 关闭透明度
        opacity: 1.0,
        depthWrite: true,       // 深度写入
        blending: THREE.NoBlending,
    });

    State.currentPointCloud = new THREE.Points(geometry, material);
    State.currentPointCloud.frustumCulled = false;      // 防止相机转动时，边缘的点突然消失或闪烁
    
    const targetScale = State.lastUserScale; 
    
    // 应用缩放
    State.currentPointCloud.scale.set(targetScale, targetScale, targetScale);
    State.pointCloudScene.add(State.currentPointCloud);

    // ---- 设置模型的旋转中心为自身
    // 获取模型中心
    const selfcenter = new THREE.Vector3();
    geometry.computeBoundingBox();
    geometry.boundingBox.getCenter(selfcenter);

    // 更新 TrackballControls 的旋转中心（关键！）
    if (State.pointCloudControls) {
        State.pointCloudControls.target.copy(selfcenter);
        State.pointCloudControls.update();
    }

    // 计算模型包围球半径
    geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere.radius;
    const safeRadius = radius < 0.001 ? 1.0 : radius;

    // 动态设置 near（至少为模型半径的 0.1%）
    const newNear = Math.max(0.0001, safeRadius * 0.001); // 例如：模型半径 1m → near=0.001m

    State.pointCloudCamera.near = newNear;
    State.pointCloudCamera.updateProjectionMatrix(); 

    console.log(`✅ 渲染完成 | 点数：${vertexCount} | 尺寸因子：${(safeMaxDim * 0.008).toFixed(4)}`);
    console.groupEnd();
}

// 补充缺失的 createGradientCanvas 函数（确保代码可运行）
function createGradientCanvas(color1, color2) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    return canvas;
}

// ========== 导出所有公共函数 ==========
export {
    // 重建相关
    startReconstruction,
    
    // 点云加载和管理
    loadPointCloudFrames,
    loadPointCloudFrame,
    load_AllFrames2Memory,
    updateCacheStatus,
    
    // 点云视图控制
    initPointCloudViewer,
    updatePointCloud,
    parsePLY,
    
    // 动画和事件
    animatePointCloud,
    onPointCloudResize,
};