import { mountWhale } from './runtime.js';
import './style.css';
const container = document.querySelector('#app');
mountWhale(container, { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches }).then(function (whale) {
  whale.start();
  document.addEventListener('visibilitychange', function () { if (document.hidden) whale.pause(); else whale.resume(); });
}).catch(function () { container.textContent = '蓝鲸暂时无法加载，请换一台设备再试。'; });
