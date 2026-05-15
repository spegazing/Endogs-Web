// 导入 State 模块
import {State} from './state.js';
import * as Api from './api.js'
import * as UiController from './uicontroller.js'
import * as Mask from './mask.js'
import {initPointCloudViewer,loadPointCloudFrames} from './reconstruct.js'

// uploadvideo
async function uploadVideo() {
    const fileInput = document.getElementById('videoInput');
    const status = document.getElementById('uploadStatus');
    const wrapper = document.getElementById('uploadProgressWrapper');
    const bar = document.getElementById('uploadProgressBar');
    const uploadBtn = document.getElementById('uploadBtn');

    if (fileInput.files.length === 0) {
        alert("请先选择文件");
        return;
    }

    const selectedForm = document.getElementById('uploadModeSelect').value;
    const formData = new FormData();

    if (selectedForm === "video") {
        formData.append('type', 'video');
        formData.append('file', fileInput.files[0]);
    } else {
        formData.append('type', 'zip');
        formData.append('file', fileInput.files[0]);
    }
    
    // UI
    uploadBtn.disabled = true;
    wrapper.style.display = 'flex';
    bar.style.width = '0%';
    bar.innerText = '0%';
    bar.className = "progress-bar progress-bar-striped progress-bar-animated bg-primary";
    status.innerText = "准备上传...";
    
    // upload the video to the server
    try {
        const result = await Api.api_uploadFile(formData, (percent) => {
            bar.style.width = percent + '%';
            bar.innerText = percent + '%';
            status.innerText = `正在上传并处理: ${percent}%`;
        }, '/upload');
        console.log('Response:', result);

        if (result.success === false) {
            throw new Error(result.error || '上传失败');
        }

        State.currentProjectId = result.project_id;
        status.innerHTML = `<span style="color:green">✅ ${result.message}</span>`; // 修正：res → result
        State.total_ImageCount = result.image_count;
        bar.className = "progress-bar bg-success";
        bar.style.width = '100%';

        switchPreviewTab('rgb');
        uploadBtn.textContent = "重新上传";
        uploadBtn.disabled = false;

        // 页面跳转
        const targetCard = document.getElementById('main-content');
        if (targetCard) {
            const targetPosition = targetCard.getBoundingClientRect().top + window.pageYOffset;
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
        
        UiController.goToStep('next');
        
    } catch (error) {
        console.error('Upload Error:', error);
        
        let errorMsg = '上传失败';
        if (error instanceof Error) {
            errorMsg = error.message;
        } else if (typeof error === 'string') {
            errorMsg = error;
        }

        status.innerHTML = `<span style="color:red">❌ ${errorMsg}</span>`;
        bar.className = "progress-bar bg-danger";
        uploadBtn.disabled = false;
    }
}

// uploaddepthzip
async function uploadDepthZip() {
    const fileInput = document.getElementById('depthZipInput');
    if (fileInput.files.length === 0) {
        alert("请选择深度图压缩包");
        return;
    }

    const formData = new FormData();

    formData.append('project_id', State.currentProjectId);
    formData.append('file', fileInput.files[0]);

    const status = document.getElementById('depthStatus');
    status.innerHTML = '上传中...';

    try {
        const res = await Api.api_uploadFile(formData, null, 'upload_depth');

        if (res.image_count !== State.total_ImageCount) {
            status.innerHTML = `<span style="color:red">❌ 上传失败， 文件数量不一致，请重新上传</span>`;
            return;
        }
        status.innerHTML = `<span style="color:green">✅ ${res.message}</span>`;

        State.currentPreviewMode = 'depth';
        switchPreviewTab('depth');
    } catch (err) {
        console.error('Upload Depth Error:', err);
        status.innerHTML = `<span style="color:red">❌ 上传失败，请重新上传</span>`;
        return;
    }
}

// uploadmaskzip
async function uploadMaskZip() {
    const fileInput = document.getElementById('maskZipInput');
    if (fileInput.files.length === 0) {
        alert("请选择掩码图压缩包");
        return;
    }
    
    const formData = new FormData();

    formData.append('project_id', State.currentProjectId);
    formData.append('file', fileInput.files[0]);
    
    const status = document.getElementById('maskStatus');
    status.innerHTML = '上传中...';
    
    // upload the mask zip file to the server
    try {
        const res = await Api.api_uploadFile(formData, null, 'upload_mask');

        if (res.image_count !== State.total_ImageCount) {
            status.innerHTML = `<span style="color:red">❌ 上传失败， 文件数量不一致，请重新上传</span>`;
            return;
        }
        status.innerHTML = `<span style="color:green">✅ ${res.message}</span>`;
        State.currentPreviewMode = 'mask';
        switchPreviewTab('mask');
    } catch (err) {
        console.error('Upload Mask Error:', err);
        status.innerHTML = `<span style="color:red">❌ 上传失败，请重新上传</span>`;
        return;
    }
}

// switch preview tab
function switchPreviewTab(mode) {
    if (!mode) {
        console.error('[Error] switchPreviewTab called without a valid mode.');
        return;
    }

    console.log(`[SwitchTab] Switching to mode: ${mode}`);
    State.currentPreviewMode = mode;

    const tabs = document.querySelectorAll('.preview-tab');
    if (!tabs || tabs.length === 0) {
        console.warn('[Warning] No .preview-tab elements found in DOM.');
    } else {
        tabs.forEach(tab => tab.classList.remove('active'));
        console.log('123');
        const tabMap = {
            'rgb': 'RGB 图像',
            'mask': '掩码图',
            'depth': '深度图',
            'pointcloud': '3D 点云'
        };
        
        const targetText = tabMap[mode];
        if (targetText) {
            let activated = false;
            tabs.forEach(tab => {
                console.log('456');
                const text = tab.textContent ? tab.textContent.trim() : '';
                if (text.includes(targetText)) {
                    tab.classList.add('active');
                    activated = true;
                    console.log(`[SwitchTab] Activated tab: ${targetText}`);
                }
            });
            if (!activated) {
                console.warn(`[Warning] Could not find tab with text containing "${targetText}"`);
            }
        }
    }
    
    const container = document.getElementById('previewContainer');
    const imageStream = document.getElementById('imageStream');
    const pointCloudStream = document.getElementById('pointCloudStream');
    const emptyPreviewState = document.getElementById('emptyPreviewState');

    console.log('[DEBUG] imageStream:', imageStream);
    console.log('[DEBUG] pointCloudStream:', pointCloudStream);

    if (mode === 'pointcloud') {
        container.style.display = 'block';
        emptyPreviewState.style.display = 'none';
        
        // 隐藏 imageStream
        if (imageStream) {
            imageStream.style.display = 'none';
            imageStream.style.visibility = 'hidden';
            imageStream.style.opacity = '0';
            imageStream.style.position = 'absolute';
        }
        
        // 显示点云流
        if (pointCloudStream) {
            pointCloudStream.style.display = 'block';
            pointCloudStream.style.visibility = 'visible';
            pointCloudStream.style.opacity = '1';
            pointCloudStream.style.position = 'relative';
            pointCloudStream.style.width = '100%';
            pointCloudStream.style.height = '100%';
        }

        if (!State.pointCloudScene) { 
            console.log("[SwitchTab] 首次初始化点云场景...");
            // 检查 initPointCloudViewer 是否存在
            if (typeof initPointCloudViewer === 'function') {
                initPointCloudViewer(); 
            }
        } else {
            console.log("[SwitchTab] 场景已存在，调整大小...");
            if (typeof onPointCloudResize === 'function') onPointCloudResize();
        }

        if (!State.pointCloudFrames || State.pointCloudFrames.length === 0) {
            console.log("📡 [SwitchTab] 帧列表为空，调用 loadPointCloudFrames() 获取数据...");
            
            if (!State.currentProjectId) {
                console.error("❌ 错误：currentProjectId 为空");
                alert("未找到项目 ID");
                container.style.display = 'none';
                emptyPreviewState.style.display = 'block';
                return;
            }
            
            // 检查 loadPointCloudFrames 是否存在
            if (typeof loadPointCloudFrames === 'function') {
                loadPointCloudFrames(); 
            }
        } else {
            console.log("♻️ [SwitchTab] 帧列表已有数据，直接加载...");
            if (typeof loadPointCloudFrame === 'function') {
                loadPointCloudFrame(State.currentFrameIndex);
            }
        }
        
        State.isPlaying = false;
        if (typeof stopPlayback === 'function') stopPlayback();

    } else {
        // 隐藏点云流，显示图像流
        if (pointCloudStream) {
            pointCloudStream.style.display = 'none';
            pointCloudStream.style.visibility = 'hidden';
            pointCloudStream.style.opacity = '0';
            pointCloudStream.style.position = 'absolute';
        }

        if (imageStream) {
            imageStream.style.display = 'flex';
            imageStream.style.visibility = 'visible';
            imageStream.style.opacity = '1';
            imageStream.style.position = 'relative';
            imageStream.style.width = '100%';
            imageStream.style.height = '100%';
        }
        
        State.isPlaying = false;
        if (typeof stopPlayback === 'function') stopPlayback();

        if (State.currentProjectId) {
            const folderName = mode === 'rgb' ? 'images' : (mode === 'mask' ? 'masks' : 'depth');
            
            console.log(`[SwitchTab] 请求 ${folderName} 图片数量...`);
            fetch(`/get_img_count/${State.currentProjectId}/${folderName}`)
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.json();
                })
                .then(data => {
                    if (typeof renderPreview === 'function') {
                        renderPreview(State.currentProjectId, data.image_count || 0);
                    }
                })
                .catch(err => {
                    console.error('[SwitchTab] Failed to fetch image count:', err);
                    if (typeof renderPreview === 'function') {
                        renderPreview(State.currentProjectId, 0);
                    }
                });
        }
    }
}

function renderPreview(projectId, count) {
    const emptyPreview = document.getElementById('emptyPreviewState');
    const container = document.getElementById('previewContainer');
    const stream = document.getElementById('imageStream');

    if (!stream || !container || !emptyPreview) {
        console.error('Required DOM elements not found');
        return;
    }

    if (!count) {
        container.style.display = 'none';
        emptyPreview.style.display = 'block';
        return;
    }

    container.style.display = 'block';
    emptyPreview.style.display = 'none';
    stream.innerHTML = ''; // 清空旧内容

    State.currentProjectId = projectId;
    
    for (let i = 0; i < (count || 0); i++) {
        const imgNum = i.toString().padStart(5, '0'); 

        // 1. 创建外层包裹容器
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-img-wrapper';

        // 2. 创建图片元素
        const img = document.createElement('img');
        img.className = 'preview-img';
        img.alt = `Frame ${imgNum}`;
        img.dataset.frameIndex = i;

        // 设置图片源 (这里依然需要补零，否则找不到文件)
        if (State.currentPreviewMode === 'rgb') {
            img.src = `/get_image/${projectId}/${imgNum}.jpg`;
        } else if (State.currentPreviewMode === 'depth') {
            img.src = `/get_depth/${projectId}/${imgNum}.png`;
            img.classList.add('depth');
        } else if (State.currentPreviewMode === 'mask') {
            img.src = `/get_mask/${projectId}/${imgNum}.png`;
            img.classList.add('mask');
        }

        // 3. 创建悬浮编号元素
        const badge = document.createElement('div');
        badge.className = 'frame-badge';
        
        badge.textContent = i; 

        // 4. 组装
        wrapper.appendChild(img);
        wrapper.appendChild(badge);
        stream.appendChild(wrapper);

        // 5. 绑定点击事件
        img.onclick = function(e) {
            const frameIndex = parseInt(this.dataset.frameIndex);
            const maskSegmentCheckbox = document.getElementById('maskSegment');
            if (State.currentPreviewMode === 'rgb' && maskSegmentCheckbox && maskSegmentCheckbox.checked) {
                if (typeof Mask.openSegmentationModal === 'function') {
                    Mask.openSegmentationModal(projectId, frameIndex);
                }
            }
        };
    }
    
    const statusEl = document.getElementById('uploadStatus');
    if (statusEl) {
        statusEl.innerHTML = `<span style="color:green">✅ 项目 ${projectId} 已就绪，请继续深度/掩码处理</span>`;
    }
    
    const maskSegmentCheckbox = document.getElementById('maskSegment');
    if (maskSegmentCheckbox && maskSegmentCheckbox.checked) {
        setTimeout(() => {
            try {
                if (typeof UiController.toggleMaskUI === 'function') {
                    UiController.toggleMaskUI();
                }
                if (typeof State.markedFrames !== 'undefined' && State.markedFrames.size > 0) {
                    if (typeof Mask.renderMarkedFramesList === 'function') {
                        Mask.renderMarkedFramesList();
                    }
                }
            } catch (e) {
                console.warn('Failed to update mask UI after render:', e);
            }
        }, 50);
    }
}
// ==========================================
// 导出所有需要对外暴露的函数
// ==========================================
export {
    uploadVideo,        // 视频/zip文件上传
    uploadDepthZip,     // 深度图压缩包上传
    uploadMaskZip,      // 掩码图压缩包上传
    switchPreviewTab,   // 预览标签切换
    renderPreview       // 预览图渲染
  };
  