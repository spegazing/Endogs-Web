import * as UTILS from './utils.js'
import * as Mask from './mask.js'
import * as Depth from './depth.js'
import * as Reconstruct from './reconstruct.js'
import * as Ply3d from './pointcloud-interaction.js'
import {State} from './state.js';

//init-load-page
function load_init_page(){
    toggleInput();
    toggleMaskUI();
    toggleDepthUI();
    
    initEventListeners();

    // process-handle
    for (let i = 2; i <= State.totalSteps; i++) {
        const step =  document.getElementById(`step${i}`);
        if (step) step.style.display = 'none';
    }

    updateNavButtons();
}

// assist-function
function MyaddEventListener(eleId, event, callback){
    const ele = document.getElementById(eleId);
    if(ele)  {   
        if (event === 'load') 
            callback();
        else 
        ele.addEventListener(event, callback);
    }
    else  console.warn(`Element with id '${eleId}' not found.`);
}


// modifySettingsCheck
function ModifyRecSettings(){
    const settingsPanel = document.getElementById('reconstructSettings');
    const settingsCheck = document.getElementById('modifySettingsCheck');
    const inputs = settingsPanel.querySelectorAll('input[type="number"]');

    const isEnabled = settingsCheck.checked;
 
    // 遍历所有输入框
    inputs.forEach(input => {
        if (isEnabled) {
            input.removeAttribute('disabled'); // 启用：移除 disabled 属性
            input.focus(); // 可选：自动聚焦到第一个输入框，提升体验
        } else {
            input.setAttribute('disabled', 'true'); // 禁用：添加 disabled 属性
        }
    });
}

//reconstruct-setting
function PreStartReconstruct(){
    // 获取当前值 (无论是否禁用，都能获取到 value)
    const coarseVal = parseInt(document.getElementById('coarseIterations').value, 10);
    const iterVal = parseInt(document.getElementById('iterations').value, 10);
    const denseVal = parseFloat(document.getElementById('percentDense').value);

    // 只有当用户“启用”了修改模式，我们才进行严格校验
    // 如果是默认状态（禁用），我们假设默认值是合法的，直接跳过校验或使用默认值
    const settingsCheck = document.getElementById('modifySettingsCheck');
    if (settingsCheck.checked) {
        let errorMsg = '';
        if (coarseVal < 500 || coarseVal > 3000) errorMsg = '粗粒度迭代次数范围错误 (500-3000)。';
        else if (iterVal < 2000 || iterVal > 60000) errorMsg = '总迭代次数范围错误 (2000-60000)。';
        else if (iterVal <= coarseVal) errorMsg = '总迭代次数必须大于粗粒度迭代次数。';
        else if (denseVal < 0.01 || denseVal > 0.1) errorMsg = '稠密化阈值比例范围错误 (0.01-0.1)。';

        if (errorMsg) {
            alert(errorMsg);
            return; // 阻止重建
        }
    }

    // 校验通过（或处于默认模式），开始重建
    console.log("开始重建:", { coarse: coarseVal, iter: iterVal, dense: denseVal });
    State.coarseVal = coarseVal;
    State.iterVal = iterVal;
    State.denseVal = denseVal;
    // 开始重建
    Reconstruct.startReconstruction();
}

function initReconstructTooltip() {
    const tooltipBtn = document.getElementById('reconstructTooltipBtn');
    
    if (!tooltipBtn) return;

    // 定义提示内容
    const tooltipContent = `
        <div style="text-align: left;">
            <p class="mb-2">1️⃣ <strong>coarse_iterations</strong>：粗训练迭代次数（范围：1000-3000）<br>
            <span style="font-size: 0.9em; opacity: 0.9;">用于控制模型在初始阶段的训练时长，适当的设置有助于提高后续精细阶段的收敛稳定性，若设置过小，可能导致初始结构学习不充分；若设置过大，则可能增加训练时间而收益有限。</span></p>
            
            <p class="mb-2">2️⃣ <strong>iterations</strong>：总训练迭代次数（范围：2000-60000）<br>
            <span style="font-size: 0.9em; opacity: 0.9;">用于控制模型在后期细化优化过程中的训练规模。在精细阶段中，系统将引入完整的变形约束与正则项，对动态结构进行细化优化，从而提升重建质量与时空一致性。因此，该参数通常对最终结果质量具有较大影响。若设置过小，模型可能尚未充分收敛；若设置过大，则会显著增加计算成本。</span></p>
            
            <p class="mb-0">3️⃣ <strong>percent_dense</strong>：稠密化阈值比例（范围：0.01-0.1）<br>
            <span style="font-size: 0.9em; opacity: 0.9;">表示初始高斯点或体素在空间中的密度比例，用于控制模型初始表示的稠密程度。较小数值表示初始点较稀疏，可降低显存占用与训练时间，较大数值表示初始点更密集，有助于提高细节表达能力，但会增加计算成本。</span></p>
        </div>
    `;

    // 初始化 Bootstrap Tooltip
    new bootstrap.Tooltip(tooltipBtn, {
        title: tooltipContent,
        html: true,
        placement: 'right',
        trigger: 'hover'
    });
}

// initEventListner
function initEventListeners() {
    console.log('[UI] 初始化事件监听器...');

    // 事件映射表 [ElementId, EventType, HandlerFunction]
    const eventMap = [
        // --- 步骤1: 上传 ---
        ['uploadModeSelect',    'change',   toggleInput],
        ['uploadBtn',           'click',    UTILS.uploadVideo],
        
        // --- 步骤2: 掩码 ---
        ['maskExist',           'change',   toggleMaskUI],
        ['maskSegment',         'change',   toggleMaskUI],
        ['uploadMaskZip',       'click',    UTILS.uploadMaskZip],
        ['startMarkBtn',        'click',    Mask.initiateSegmentation],
        ['propagateBtn',        'click',    Mask.propagateSegmentation],

        // -- 分割帧交互区域
        ['closeSegmentionBtn',      'click',    Mask.closeSegmentationModal],
        ['modeTargetBtn',           'click',    () => Mask.setAnnotationMode('target')], 
        ['modeNonTargetBtn',        'click',    () => Mask.setAnnotationMode('nontarget')], 
        ['undoPointBtn',            'click',    Mask.undoLastPoint],
        ['clearPointBtn',           'click',    Mask.clearAllPoints],
        ['generateCurrentFrameBtn', 'click',    Mask.generateCurrentMask],
        ['saveMarkersBtn',          'click',    Mask.saveFrameMarkers],
        ['finishSegmentationBtn',   'click',    Mask.closeSegmentationModal],

        // --- 步骤3: 深度 ---
        ['depthExist',          'change',   toggleDepthUI],
        ['depthEstimate',       'change',   toggleDepthUI],
        ['uploadDepthZip',      'click',    UTILS.uploadDepthZip], // 修正：补充缺失的逗号
        ['DepthEstBtn',         'click',    Depth.startDepthEstimation],

        // --- 步骤4: 重建 ---
        ['reconstructTooltipBtn', 'load',   initReconstructTooltip],
        ['modifySettingsCheck', 'change',   ModifyRecSettings],
        ['reconstructBtn',      'click',    PreStartReconstruct],

        // -- 预览区域
        ['switch_rgb_btn',      'click',    () => UTILS.switchPreviewTab('rgb')],
        ['switch_mask_btn',     'click',    () => UTILS.switchPreviewTab('mask')],
        ['switch_depth_btn',    'click',    () => UTILS.switchPreviewTab('depth')], 
        ['switch_pointcloud_btn',      'click',    () => UTILS.switchPreviewTab('pointcloud')], 

        // -- 点云交互区域
        ['enscale_pointcloud_btn',      'click',    () => Ply3d.scalePointCloud(1)], 
        ['descale_pointcloud_btn',      'click',    () => Ply3d.scalePointCloud(-1)], 
        ['resetScaleBtn',               'click',    Ply3d.resetScale],

        ['bgColorStart',       'change',    Ply3d.changeBackgroundGradient],
        ['bgColorEnd',         'change',    Ply3d.changeBackgroundGradient],
        ['bgTransparent',      'click',    Ply3d.setTransparentBackground],

        ['gridToggleBtn',      'click',    Ply3d.toggleGrid],
        ['downloadFramesBtn',  'click',    Ply3d.downloadAllFrames],
        
        ['pre_FrameBtn',       'click',    () => Ply3d.SwitchFrame(-1)], 
        ['next_FrameBtn',      'click',    () => Ply3d.SwitchFrame(1)], 

        ['play_PointCloudBtn',      'click',    Ply3d.togglePlayback], 
        ['en_PlaySpeedBtn',      'click',    () => Ply3d.adjustSpeed(0.1)], 
        ['de_PlaySpeedBtn',      'click',    () => Ply3d.adjustSpeed(-0.1)], 
        
        // --- 步骤切换 ---
        ['nextBtn',             'click',    () => goToStep('next')],
        ['prevBtn',             'click',    () => goToStep('prev')],
        
    ];

    // 批量绑定
    eventMap.forEach(([id, event, handler]) => {
        MyaddEventListener(id, event, handler); 
    });

    // --- 单独处理 window 事件 ---
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('segmentationModal');
        if (modal && event.target === modal) {
            Mask.closeSegmentationModal(); 
        }
    });
    console.log('[UI] 事件监听器初始化完成');
}

// init-page input
function toggleInput() {
    const selectedForm = document.getElementById('uploadModeSelect').value;
    const fileInput = document.getElementById('videoInput');
    const fileLabel = document.querySelector('label[for="videoInput"]');
    
    if (selectedForm == "video") {
        fileInput.setAttribute('accept', '.mp4,.avi,.mov');
        fileLabel.innerText = "选择视频文件 (MP4, AVI, MOV)";
    } else {
        fileInput.setAttribute('accept', '.zip');
        fileLabel.innerText = "选择图像序列压缩包 (.zip)";
    }
}

// mask-UI
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
        if (State.markedFrames.size > 0) {
            if (propagateBtn) propagateBtn.style.display = 'block';
            if (markedFramesContainer) {
                markedFramesContainer.style.display = 'block';
                if (Mask.renderMarkedFramesList) Mask.renderMarkedFramesList();
            }
        } else {
            if (propagateBtn) propagateBtn.style.display = 'none';
            if (markedFramesContainer) markedFramesContainer.style.display = 'none';
        }
    }
}

// depth-UI
function toggleDepthUI() {
    const isExist = document.getElementById('depthExist').checked;
    document.getElementById('depthExistPanel').style.display = isExist ? 'block' : 'none';
    document.getElementById('depthEstimatePanel').style.display = isExist ? 'none' : 'block';
}

// switch step
function goToStep(direction) {
    // 1. 先判断是否允许切换，如果不允许直接返回
    if (direction === 'next' && State.currentStep >= State.totalSteps) {
        alert('流程结束！'); 
        return;
    }
    
    if (direction === 'prev' && State.currentStep <= 1) return;

    // 2. 隐藏当前步骤
    const currentPanel = document.getElementById(`step${State.currentStep}`);
    if (currentPanel) {
        currentPanel.style.display = 'none';
    }

    // 3. 更新步骤号 (注意：这一步必须在隐藏之后，显示之前)
    if (direction === 'next') {
        State.currentStep++;
    } else if (direction === 'prev') {
        State.currentStep--;
    }

    // 4. 显示新步骤
    const nextPanel =  document.getElementById(`step${State.currentStep}`);
    if (nextPanel) {
        nextPanel.style.display = 'block'; 
    }

    // 5. 更新按钮状态
    updateNavButtons();
}

// update nav buttons
function updateNavButtons() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
  
    if (State.currentStep === 1) {
      prevBtn.style.display = 'none';
    } else {
      prevBtn.style.display = 'inline-flex'; 
    }
  
    if (State.currentStep === State.totalSteps) {
      nextBtn.innerHTML = '完成';
    } else {
      nextBtn.innerHTML = '下一步 →';
    }
  }
  

  export {
    load_init_page,       // 页面初始化主函数（核心导出）
    goToStep,             // 步骤切换函数（可选导出，外部可能需要调用）
    toggleInput,          // 上传输入切换（可选导出）
    toggleMaskUI,         // 掩码UI切换（可选导出）
    toggleDepthUI,        // 深度UI切换（可选导出）
    updateNavButtons      // 导航按钮更新（可选导出）
  };