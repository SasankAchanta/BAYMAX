import {defineConfig} from 'vite';
export default defineConfig({
 // The YOLO wrapper initializes its own pinned ORT runtime from /runtime/.
 // Do not let Vite prebundle a second runtime or rewrite its module URLs.
 optimizeDeps:{exclude:['onnxruntime-web','@ultralytics/yolo']},
 server:{proxy:{'/api':{target:'http://127.0.0.1:8000',changeOrigin:true}},headers:{'Cache-Control':'no-store'}},
});
