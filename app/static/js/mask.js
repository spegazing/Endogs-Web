import { api_uploadFile } from "./api.js";
import { State } from "./state.js"; // 引入状态模块
import {switchPreviewTab} from "./utils.js"

// ================== mask-UI ===================
function toggleMaskUI() {
    const isExist = document.getElementById('maskExist').checked;
    const isSegment = document.getElementById('maskSegment').checked;
    
    const maskExistPanel = document.getElementById('maskExistPanel');
    const maskSegmentPanel = document.getElementById('maskSegmentPanel');
    const startMarkBtn = document.getElementById('startMarkBtn');
    const propagateBtn = document.getElementById('propagateBtn');
    const markedFramesContainer = document.getElementById('markedFramesContainer');
    
    if (maskExistPanel) maskExistPanel.style.display = isExist ? 'block' : 'none';
    if (maskSegmentPanel) maskSegmentPanel.style.display = isExist ? 'none' : 'block';
    
    if (isSegment) {
        if (startMarkBtn) startMarkBtn.style.display = 'block';
        
        // ✅ 修改：使用 State.markedFrames
        if (State.markedFrames.size > 0) {
            if (propagateBtn) propagateBtn.style.display = 'block';
            if (markedFramesContainer) {
                markedFramesContainer.style.display = 'block';
                renderMarkedFramesList();
            }
        } else {
            if (propagateBtn) propagateBtn.style.display = 'none';
            if (markedFramesContainer) markedFramesContainer.style.display = 'none';
        }
    }
}

// uploadmaskzip
function uploadMaskZip() {
    const fileInput = document.getElementById('maskZipInput');
    if (!fileInput || fileInput.files.length === 0) {
        alert("请选择掩码图压缩包");
        return;
    }
    
    const formData = new FormData();
    // ✅ 修改：使用 State.currentProjectId
    formData.append('project_id', State.currentProjectId);
    formData.append('file', fileInput.files[0]);
    
    const status = document.getElementById('maskStatus');
    if (!status) return;
    status.innerHTML = '上传中...';
    
    // ✅ 修复：移除了之前断裂的 api_uploadFile 调用，统一使用 fetch 或你可以改用 api_uploadFile
    // 这里为了保持逻辑稳定，暂时保留原有的 fetch 逻辑，但更新了变量引用
    fetch('/upload_mask', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        // ✅ 修改：使用 State.total_ImageCount
        if(data.image_count != State.total_ImageCount){
            status.innerHTML = `<span style="color:red">❌ 上传失败，文件数量不一致 (期望:${State.total_ImageCount}, 实际:${data.image_count})，请重新上传</span>`;
            return;
        }
        status.innerHTML = `<span style="color:green">✅ ${data.message}</span>`;
        
        // ✅ 修改：使用 State.currentPreviewMode
        State.currentPreviewMode = 'mask';
        switchPreviewTab('mask');
    })
    .catch(err => {
        console.error(err);
        status.innerHTML = `<span style="color:red">❌ 上传失败: ${err.message}</span>`;
    });
}

// ================== 已标记帧管理 ===============
function renderMarkedFramesList() {
    const container = document.getElementById('markedFramesList');
    const countDisplay = document.getElementById('markedFramesCount');
    const markedFramesContainer = document.getElementById('markedFramesContainer');
    const propagateBtn = document.getElementById('propagateBtn');
    
    if (!container || !countDisplay || !markedFramesContainer || !propagateBtn) {
        console.warn('Required DOM elements not found');
        return;
    }
    
    container.innerHTML = '';
    
    // ✅ 修改：使用 State.markedFrames
    if (State.markedFrames.size === 0) {
        markedFramesContainer.style.display = 'none';
        propagateBtn.style.display = 'none';
        return;
    }
    
    markedFramesContainer.style.display = 'block';
    propagateBtn.style.display = 'block';
    countDisplay.innerText = State.markedFrames.size;
    
    // ✅ 修改：使用 State.markedFrames
    const sortedFrames = Array.from(State.markedFrames.entries()).sort((a, b) => a[0] - b[0]);
    
    sortedFrames.forEach(([frameIdx, data]) => {
        const targetCount = data.points.filter(p => p.label === 1).length;
        const nontargetCount = data.points.filter(p => p.label === 0).length;
        
        const item = document.createElement('div');
        item.className = 'marked-frame-item';
        item.innerHTML = `
            <div>
                <span class="frame-badge-mask">帧 ${frameIdx}</span>
                <span class="point-count">🎯 ${targetCount} | ❌ ${nontargetCount}</span>
                ${data.maskGenerated ? '<span class="badge bg-success ms-2">已生成</span>' : ''}
            </div>
            <div>
                <span class="delete-frame" onclick="removeMarkedFrame(${frameIdx}, event)">&times;</span>
            </div>
        `;
        container.appendChild(item);
    });
}
window.removeMarkedFrame = removeMarkedFrame;
function removeMarkedFrame(frameIdx, event) {
    if (event) {
        event.stopPropagation();
    }
    
    // ✅ 修改：使用 State.markedFrames
    if (State.markedFrames.has(frameIdx)) {
        State.markedFrames.delete(frameIdx);
        renderMarkedFramesList();
        
        // ✅ 修改：使用 State.currentAnnotationFrame
        if (State.currentAnnotationFrame === frameIdx) {
            // ✅ 修改：使用 State.annotationPoints
            State.annotationPoints = [];
            if (State.canvas && State.ctx) {
                redrawPoints();
            }
        }
        
        showStatus('已移除帧 ' + frameIdx + ' 的标记信息', 'info');
    }
}

function saveFrameMarkers() {
    // ✅ 修改：使用 State.annotationPoints
    if (State.annotationPoints.length === 0) {
        alert('请至少添加一个标记点');
        return;
    }
    
    // ✅ 修改：使用 State.markedFrames 和 State.currentAnnotationFrame
    State.markedFrames.set(State.currentAnnotationFrame, {
        points: State.annotationPoints.map(p => ({...p})),
        timestamp: new Date().getTime(),
        maskGenerated: State.markedFrames.has(State.currentAnnotationFrame) ? 
            State.markedFrames.get(State.currentAnnotationFrame).maskGenerated : false
    });

    renderMarkedFramesList();
    showStatus(`✅ 已保存帧 ${State.currentAnnotationFrame} 的标记信息 (${State.annotationPoints.length}个点)`, 'success');
}

// ================= 辅助函数 ====================
function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('maskStatus');
    if (!statusEl) return;
    const colors = {
        success: 'green',
        error: 'red',
        info: 'blue',
        warning: 'orange'
    };
    statusEl.innerHTML = `<span style="color:${colors[type] || 'black'}">${message}</span>`;
}


// ================ 交互式分割核心函数 ============
function initiateSegmentation() {
    // ✅ 修改：使用 State.currentProjectId
    if (!State.currentProjectId) {
        alert('请先上传项目');
        return;
    }
    alert('请在右侧 RGB 预览图中点击任意帧开始交互式标记');
    switchPreviewTab('rgb');
}

function openSegmentationModal(projectId, frameIdx) {
    // ✅ 修改：使用 State
    State.currentProjectId = projectId;
    State.currentAnnotationFrame = frameIdx;
    
    const frameIdxDisplay = document.getElementById('currentFrameIdx');
    if(frameIdxDisplay) frameIdxDisplay.innerText = frameIdx;
    
    // ✅ 修改：使用 State.markedFrames 和 State.annotationPoints
    if (State.markedFrames.has(frameIdx)) {
        State.annotationPoints = State.markedFrames.get(frameIdx).points.map(p => ({...p}));
    } else {
        State.annotationPoints = [];
    }
    
    updatePointStats();                                     
    const pointMarkers = document.getElementById('pointMarkers');
    if(pointMarkers) pointMarkers.innerHTML = ''; 
    
    // 加载该帧图像到 canvas
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    // ✅ 修改：使用 State.currentProjectId
    img.src = `/get_image/${State.currentProjectId}/${frameIdx.toString().padStart(5, '0')}.jpg`;
    
    img.onload = function() {
        State.canvas = document.getElementById('annotationCanvas');
        if (!State.canvas) return;
        
        State.ctx = State.canvas.getContext('2d');
        
        // 设置 canvas 尺寸适应图像
        const maxWidth = 1000;
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
        }
        
        State.canvas.width = width;
        State.canvas.height = height;
        
        // 绘制图像
        State.ctx.drawImage(img, 0, 0, width, height);
        State.canvasImage = img;
        
        // 移除之前的事件监听器
        if (State.canvasClickHandler) {
            State.canvas.removeEventListener('click', State.canvasClickHandler);
        }
        if (State.canvasMouseMoveHandler) {
            State.canvas.removeEventListener('mousemove', State.canvasMouseMoveHandler);
        }
        
        // 创建新的事件处理器
        State.canvasClickHandler = function(e) {
            const rect = State.canvas.getBoundingClientRect();
            const scaleX = State.canvas.width / rect.width;
            const scaleY = State.canvas.height / rect.height;
            const x = Math.round((e.clientX - rect.left) * scaleX);
            const y = Math.round((e.clientY - rect.top) * scaleY);
            addPoint(x, y, State.currentAnnotationMode === 'target' ? 1 : 0);
        };
        
        State.canvasMouseMoveHandler = function(e) {
            const rect = State.canvas.getBoundingClientRect();
            const scaleX = State.canvas.width / rect.width;
            const scaleY = State.canvas.height / rect.height;
            const x = Math.round((e.clientX - rect.left) * scaleX);
            const y = Math.round((e.clientY - rect.top) * scaleY);
            const coordDisplay = document.getElementById('coordDisplay');
            if(coordDisplay) coordDisplay.innerHTML = `X: ${x}, Y: ${y}`;
        };
        
        // 添加新的事件监听器
        State.canvas.addEventListener('click', State.canvasClickHandler);
        State.canvas.addEventListener('mousemove', State.canvasMouseMoveHandler);
        
        // 重新绘制点
        redrawPoints();
        
        const modal = document.getElementById('segmentationModal');
        if(modal) modal.style.display = 'block';
    };
}

function updatePointStats() {
    // ✅ 修改：使用 State.annotationPoints
    const targetCount = State.annotationPoints.filter(p => p.label === 1).length;
    const nontargetCount = State.annotationPoints.filter(p => p.label === 0).length;
    
    const targetDisplay = document.getElementById('targetCountDisplay');
    const nonTargetDisplay = document.getElementById('nontargetCountDisplay');
    const totalDisplay = document.getElementById('totalPointsCount');
    
    if(targetDisplay) targetDisplay.innerText = `目标：${targetCount}`;
    if(nonTargetDisplay) nonTargetDisplay.innerText = `非目标：${nontargetCount}`;
    if(totalDisplay) totalDisplay.innerText = State.annotationPoints.length;
}

function setAnnotationMode(mode) {
    // ✅ 修改：使用 State.currentAnnotationMode
    State.currentAnnotationMode = mode;
    
    const targetBtn = document.getElementById('modeTargetBtn');
    const nonTargetBtn = document.getElementById('modeNonTargetBtn');
    
    if (mode === 'target') {
        if(targetBtn) {
            targetBtn.classList.add('btn-success');
            targetBtn.classList.remove('btn-outline-success');
        }
        if(nonTargetBtn) {
            nonTargetBtn.classList.add('btn-outline-danger');
            nonTargetBtn.classList.remove('btn-danger');
        }
    } else {
        if(nonTargetBtn) {
            nonTargetBtn.classList.add('btn-danger');
            nonTargetBtn.classList.remove('btn-outline-danger');
        }
        if(targetBtn) {
            targetBtn.classList.add('btn-outline-success');
            targetBtn.classList.remove('btn-success');
        }
    }
}

function addPoint(x, y, label) {
    // ✅ 修改：使用 State.annotationPoints
    State.annotationPoints.push({x, y, label});
    redrawPoints();
    updatePointStats();
}

function undoLastPoint() {
    // ✅ 修改：使用 State.annotationPoints
    State.annotationPoints.pop();
    redrawPoints();
    updatePointStats();
}

function clearAllPoints() {
    // ✅ 修改：使用 State.annotationPoints
    State.annotationPoints = [];
    redrawPoints();
    updatePointStats();
}

function redrawPoints() {
    if (!State.canvas || !State.ctx) return;
    
    // 重绘图像
    if (State.canvasImage) {
        State.ctx.drawImage(State.canvasImage, 0, 0, State.canvas.width, State.canvas.height);
    }
    
    // 清除旧标记点容器
    const markersContainer = document.getElementById('pointMarkers');
    if(markersContainer) markersContainer.innerHTML = '';
    
    // ✅ 修改：使用 State.annotationPoints
    State.annotationPoints.forEach((point, index) => {
        // 在 canvas 上画点
        State.ctx.beginPath();
        State.ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
        State.ctx.fillStyle = point.label === 1 ? '#00ff00' : '#ff0000';
        State.ctx.fill();
        State.ctx.strokeStyle = 'white';
        State.ctx.lineWidth = 2;
        State.ctx.stroke();
        
        // 添加序号标签
        State.ctx.font = 'bold 14px Arial';
        State.ctx.fillStyle = 'white';
        State.ctx.shadowColor = 'black';
        State.ctx.shadowBlur = 4;
        State.ctx.fillText(`${index+1}`, point.x + 12, point.y - 12);
        State.ctx.shadowBlur = 0;
        
        // 添加标签文字
        State.ctx.font = '12px Arial';
        State.ctx.fillStyle = 'white';
        State.ctx.shadowBlur = 4;
        State.ctx.fillText(point.label === 1 ? '目标' : '非目标', point.x + 12, point.y + 20);
        State.ctx.shadowBlur = 0;
    });
}

function closeSegmentationModal() {
    const modal = document.getElementById('segmentationModal');
    if (modal) modal.style.display = 'none';
    
    if (State.canvas) {
        if (State.canvasClickHandler) State.canvas.removeEventListener('click', State.canvasClickHandler);
        if (State.canvasMouseMoveHandler) State.canvas.removeEventListener('mousemove', State.canvasMouseMoveHandler);
        State.canvasClickHandler = State.canvasMouseMoveHandler = null;
    }
}


// ========== 当前帧掩码分割 ===================
function generateCurrentMask() {
    // ✅ 修改：使用 State.annotationPoints
    if (State.annotationPoints.length === 0) {
        alert('请至少添加一个标记点');
        return;
    }
    
    // ✅ 修改：使用 State.markedFrames, State.currentAnnotationFrame
    State.markedFrames.set(State.currentAnnotationFrame, {
        points: State.annotationPoints.map(p => ({...p})),
        timestamp: new Date().getTime(),
        maskGenerated: true
    });
    
    const points = State.annotationPoints.map(p => [p.x, p.y]);
    const labels = State.annotationPoints.map(p => p.label);
    
    const data = {
        // ✅ 修改：使用 State.currentProjectId
        project_id: State.currentProjectId,
        frame_idx: State.currentAnnotationFrame,
        points: points,
        labels: labels,
        propagate: false
    };
    
    const status = document.getElementById('maskStatus');
    if(status) status.innerHTML = `⏳ 正在生成帧 ${State.currentAnnotationFrame} 的掩码...`;
    
    fetch('/segment_single_frame', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(data => {
                throw new Error(data.error || '生成失败');
            });
        }
        return res.json();
    })
    .then(data => {
        if(status) status.innerHTML = `<span style="color:green">✅ 帧 ${State.currentAnnotationFrame} 掩码生成成功</span>`;
        
        // ✅ 修改：更新 State.markedFrames
        if (State.markedFrames.has(State.currentAnnotationFrame)) {
            const frameData = State.markedFrames.get(State.currentAnnotationFrame);
            frameData.maskGenerated = true;
            State.markedFrames.set(State.currentAnnotationFrame, frameData);
        }
        
        renderMarkedFramesList();
        
        if (confirm('掩码生成成功！是否立即查看？')) {
            switchPreviewTab('mask');
        }
    })
    .catch(err => {
        if(status) status.innerHTML = `<span style="color:red">❌ 生成失败：${err.message}</span>`;
    });
}

function submitSegmentation() {
    // ✅ 修改：使用 State.annotationPoints
    if (State.annotationPoints.length === 0) {
        alert('请至少添加一个标记点');
        return;
    }

    // ✅ 修改：使用 State.framePointsMap, State.currentAnnotationFrame
    State.framePointsMap.set(State.currentAnnotationFrame, State.annotationPoints.map(p => ({...p})));

    const points = State.annotationPoints.map(p => [p.x, p.y]);
    const labels = State.annotationPoints.map(p => p.label);

    const data = {
        // ✅ 修改：使用 State.currentProjectId
        project_id: State.currentProjectId,
        frame_idx: State.currentAnnotationFrame,
        points: points,
        labels: labels
    };

    const status = document.getElementById('maskStatus');
    if(status) status.innerHTML = '⏳ 正在生成掩码并传播至整个视频...';

    fetch('/segment_mask', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(data => {
        if(status) status.innerHTML = `<span style="color:green">✅ ${data.message}</span>`;
        closeSegmentationModal();
        
        if (confirm('掩码生成成功！是否切换到掩码预览？')) {
            switchPreviewTab('mask');
        }
    })
    .catch(err => {
        if(status) status.innerHTML = `<span style="color:red">❌ 分割失败：${err.message}</span>`;
    });
}

// ========== 多帧批量掩码分割 ==================
function propagateSegmentation() {
    // ✅ 修改：使用 State.markedFrames
    if (State.markedFrames.size === 0) {
        alert('请至少标记一帧');
        return;
    }
    
    const prompts = [];
    // ✅ 修改：遍历 State.markedFrames
    State.markedFrames.forEach((data, frameIdx) => {
        if (data.points.length > 0) {
            prompts.push({
                frame_idx: frameIdx,
                obj_id: 1,
                points: data.points.map(p => [p.x, p.y]),
                labels: data.points.map(p => p.label)
            });
        }
    });
    
    if (prompts.length === 0) {
        alert('没有有效的标记点');
        return;
    }
    
    const data = {
        // ✅ 修改：使用 State.currentProjectId
        project_id: State.currentProjectId,
        prompts: prompts
    };
    
    const status = document.getElementById('maskStatus');
    if (!status) {
        console.error('maskStatus element not found');
        return;
    }
    
    status.innerHTML = `⏳ 正在传播掩码，处理 ${prompts.length} 帧标记点...`;
    
    fetch('/segment_multi_frames', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(data => {
                throw new Error(data.error || '传播失败');
            });
        }
        return res.json();
    })
    .then(data => {
        status.innerHTML = `<span style="color:green">✅ 传播完成，生成 ${data.mask_count || '所有'} 帧掩码</span>`;
        
        // ✅ 修改：更新 State.markedFrames
        State.markedFrames.forEach((frameData, frameIdx) => {
            frameData.maskGenerated = true;
            State.markedFrames.set(frameIdx, frameData);
        });
        
        try {
            renderMarkedFramesList();
        } catch (e) {
            console.warn('Failed to render marked frames list:', e);
        }
        
        setTimeout(() => {
            switchPreviewTab('mask');
        }, 100);
    })
    .catch(err => {
        console.error('Propagation error:', err);
        status.innerHTML = `<span style="color:red">❌ 传播失败：${err.message || '未知错误'}</span>`;
    });
}

function submitMultiFrameSegmentation() {
    // ✅ 修改：使用 State.framePointsMap
    if (State.framePointsMap.size === 0) {
        alert('请至少标记一帧');
        return;
    }

    const prompts = [];
    State.framePointsMap.forEach((points, frameIdx) => {
        if (points.length > 0) {
            prompts.push({
                frame_idx: frameIdx,
                points: points.map(p => [p.x, p.y]),
                labels: points.map(p => p.label)
            });
        }
    });

    const data = {
        // ✅ 修改：使用 State.currentProjectId
        project_id: State.currentProjectId,
        prompts: prompts
    };

    const status = document.getElementById('maskStatus');
    if(status) status.innerHTML = `⏳ 正在处理 ${prompts.length} 帧标记点...`;

    fetch('/segment_multi_frames', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(data => {
        if(status) status.innerHTML = `<span style="color:green">✅ ${data.message}</span>`;
        
        if (confirm('掩码生成成功！是否切换到掩码预览？')) {
            State.currentPreviewMode = 'mask';
            switchPreviewTab('mask');
        }
    })
    .catch(err => {
        if(status) status.innerHTML = `<span style="color:red">❌ 分割失败：${err.message}</span>`;
    });
}

export{
    toggleMaskUI,
    uploadMaskZip,
    initiateSegmentation,
    propagateSegmentation,
    closeSegmentationModal,
    undoLastPoint,
    clearAllPoints,
    generateCurrentMask,
    saveFrameMarkers,
    openSegmentationModal,
    setAnnotationMode,
    submitSegmentation,
    submitMultiFrameSegmentation
};