import {State} from './state.js';
import {switchPreviewTab} from "./utils.js"

// depth-estimate
function startDepthEstimation() {
    const status = document.getElementById('depthStatus');
    status.innerHTML = '⏳ 正在估计深度图，这可能需要几分钟...';

    fetch('/estimate_depth', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({project_id: State.currentProjectId})
    })
    .then(res => res.json())
    .then(data => {
        status.innerHTML = `<span style="color:green">✅ ${data.message}</span>`;
        // 切换到深度图预览
        switchPreviewTab('depth');
    })
    .catch(err => {
        status.innerHTML = `<span style="color:red">❌ 深度估计失败</span>`;
    });
}
export{
    startDepthEstimation
}