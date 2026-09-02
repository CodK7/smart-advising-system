import{c as r}from"./index-BrLaBFKd.js";/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const o=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],d=r("circle-check",o);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const c=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],l=r("triangle-alert",c),u=(t,e,n)=>e===t?n==="ar"?"مقرر بانتظار الاسم الرسمي":"Title pending from course handbook":e,h=(t,e)=>t?e==="en"?t:{"Cyber and Information Security":"الأمن السيبراني وأمن المعلومات","Cyber & Info Security":"الأمن السيبراني وأمن المعلومات","Network Computing":"حوسبة الشبكات","Software Engineering":"هندسة البرمجيات","Data Science and Artificial Intelligence":"علم البيانات والذكاء الاصطناعي","Data & AI":"علم البيانات والذكاء الاصطناعي","Information Systems":"نظم المعلومات",Common:"السنة التأسيسية / مشترك"}[t]||t:"",p=(t,e)=>e==="en"?t:{"Diploma First Year":"دبلوم السنة الأولى","Diploma Second Year":"دبلوم السنة الثانية","Advanced Diploma":"دبلوم متقدم",BTech:"بكالوريوس تقني",Bachelor:"بكالوريوس","Year 1":"السنة الأولى","Diploma 2":"دبلوم السنة الثانية",Advanced:"متقدم"}[t]||t,f=t=>Number.isFinite(t)?Math.min(100,Math.max(0,t)):0,y=(t,e)=>{const n=t.trim(),i=/(?:z|[+-]\d{2}:?\d{2})$/i.test(n)?n:`${n.replace(" ","T")}Z`,a=new Date(i);return Number.isNaN(a.getTime())?t:new Intl.DateTimeFormat(e==="ar"?"ar-OM":"en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).format(a)};export{d as C,l as T,p as a,u as b,f as c,y as f,h as t};
