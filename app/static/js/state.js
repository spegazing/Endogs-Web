// ==========================================
// 全局状态模块 
// ==========================================

export const State = {
    // --- 项目与流程状态 ---
    currentProjectId: null,
    currentPreviewMode: 'rgb',
    total_ImageCount: 0,
    currentStep: 1,
    totalSteps: 4, 

    // --- 掩码/分割状态 ---
    currentAnnotationFrame: 0,
    annotationPoints: [],
    currentAnnotationMode: 'target',
    canvas: null,
    ctx: null,
    canvasImage: null,
    framePointsMap: new Map(),
    markedFrames: new Map(), 
    canvasClickHandler: null,
    canvasMouseMoveHandler: null,

    // --- 点云/重建状态 ---
    pointCloudScene: null,
    pointCloudCamera: null,
    pointCloudRenderer: null,
    pointCloudControls: null,
    pointCloudFrames: [],
    total_FrameCount: 0,
    currentPointCloud: null,
    currentFrameIndex: 0,
    lastUserScale: 1.0,
    pointCloudCache: new Map(),
    allFramesLoaded: false,
    pointCloudInitialized: false,

    // 用户重建参数
    coarseVal:null,
    iterVal:null,
    denseVal:null,

    // --- 播放/控制状态 ---
    playbackInterval: null,
    playbackSpeed: 1.0,
    isPlaying: false,

    gridHelper: null
};
