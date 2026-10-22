const fs=require("fs");
fs.mkdirSync("www/lib",{recursive:true});
[["three/build/three.min.js","three.min.js"],["html2canvas/dist/html2canvas.min.js","html2canvas.min.js"],["jspdf/dist/jspdf.umd.min.js","jspdf.umd.min.js"]]
 .forEach(([f,t])=>fs.copyFileSync("node_modules/"+f,"www/lib/"+t));
console.log("libs copied");
