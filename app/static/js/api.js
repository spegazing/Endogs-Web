import { PositionalAudio } from "../assets/js/three/build/three.core.js";

// ==========================================
// api.js - 基于 XMLHttpRequest (XHR) 封装
// ==========================================
/**
 * 通用的 XHR 请求封装函数
 * @param {string} url - 请求的 URL
 * @param {Object} options - 配置项 (method, data, onProgress, onSuccess, onError)
 */
function xhrRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        // 1. 处理超时
        xhr.timeout = options.timeout || 1800000;

        // 2. 处理上传进度
        if (options.method?.toUpperCase() == 'POST' && options.onUploadProgress) {
            xhr.upload.onprogress = function (e) {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    options.onUploadProgress(percent, e);
                }
            };
        }

        // 3. 处理响应
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                let data;
                try {
                    // 尝试解析 JSON
                    data = JSON.parse(xhr.responseText);
                    resolve(data); 
                } catch (err) {
                    // 如果不是 JSON，直接返回文本
                    resolve(xhr.responseText); 
                }
            } else {
                reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
            }
        };

        // 4. 处理网络错误和超时
        xhr.onerror = () => {
            reject(new Error('网络错误'));
        };

        xhr.ontimeout = () => {
            reject(new Error('请求超时'));
        };

        // 5. 发送请求
        xhr.open(options.method || 'GET', url, true);

        // 设置请求头 (FormData 不需要手动设置 Content-Type)
        if (options.method?.toUpperCase() == 'POST' && options.data) {
            if (!(options.data instanceof FormData)) {
                xhr.setRequestHeader('Content-Type', 'application/json');
            }
            xhr.send(options.data);
        } else {
            xhr.send();
        }
    });
}


// ==========================================
// 具体的业务接口函数 (供其他文件调用)
// ==========================================
/**
 * 1. 上传视频或 ZIP 文件
 * @param {FormData} formData - 包含文件和类型的表单数据
 * @param {Function} onProgress - 上传进度回调
 */
export function api_uploadFile(formData, onProgress, url) {
    return xhrRequest(url, {
        method: 'POST',
        data: formData,
        timeout: 600000,
        onUploadProgress: onProgress
    });
}