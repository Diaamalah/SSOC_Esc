const DEFAULT_TEMPLATE_2 = `Name: {{name}}\nEmail: {{email}}\nPhone: {{phone}}\nCompany: {{company}}\nAddress: {{address}}`;

const FIELD_KEYS = ["name", "email", "phone", "company", "address"];

function readFileAsText(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function cleanText(input){
  return input
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTextFromHtml(html){
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

function parseMaybeJson(text){
  try {
    return JSON.parse(text);
  } catch { return null; }
}

function flattenObject(object, prefix = ""){
  const result = {};
  for(const [key, value] of Object.entries(object || {})){
    const path = prefix ? `${prefix}.${key}` : key;
    if(value && typeof value === "object" && !Array.isArray(value)){
      Object.assign(result, flattenObject(value, path));
    } else {
      result[path] = Array.isArray(value) ? value.join(", ") : String(value ?? "");
    }
  }
  return result;
}

function guessFieldsFromText(text){
  const output = {};
  const patterns = {
    name: /(name|full\s*name)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i,
    email: /([\w.+-]+@[\w-]+\.[\w.-]+)/i,
    phone: /(phone|mobile|tel)\s*[:\-]?\s*([+]?\d[\d\s().-]{7,})/i,
    company: /(company|organization|organisation|org)\s*[:\-]?\s*([\w .,&-]{2,})/i,
    address: /(address)\s*[:\-]?\s*([\w\d ,.#\-\n]{8,})/i,
  };

  const lines = text.split(/\n+/);
  for(const line of lines){
    const l = line.trim();
    if(!output.name){ const m = l.match(patterns.name); if(m){ output.name = m[2] || m[0]; }}
    if(!output.email){ const m = l.match(patterns.email); if(m){ output.email = m[1]; }}
    if(!output.phone){ const m = l.match(patterns.phone); if(m){ output.phone = (m[2] || m[0]).replace(/\s+/g, " ").trim(); }}
    if(!output.company){ const m = l.match(patterns.company); if(m){ output.company = (m[2] || m[0]).trim(); }}
  }
  // address may span multiple lines; try again on full text
  if(!output.address){
    const m = text.match(patterns.address);
    if(m){ output.address = (m[2] || m[0]).trim(); }
  }

  return output;
}

function renderTemplate(template, data){
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.split(".").reduce((acc, k) => acc && acc[k], data);
    return value == null || value === "" ? "" : String(value);
  });
}

function getSaved(){
  try{
    return JSON.parse(localStorage.getItem("template2_items") || "[]");
  }catch{ return []; }
}
function setSaved(items){
  localStorage.setItem("template2_items", JSON.stringify(items));
}

function populateSavedList(items){
  const list = document.getElementById("savedList");
  list.innerHTML = "";
  const search = (document.getElementById("search").value || "").toLowerCase();
  items
    .filter(item => !search || JSON.stringify(item).toLowerCase().includes(search))
    .forEach((item, idx) => {
      const li = document.createElement("li");
      const top = document.createElement("div");
      top.className = "row";
      const title = document.createElement("div");
      title.textContent = item.fields.name || item.fields.email || `Entry ${idx+1}`;
      const actions = document.createElement("div");
      const copyBtn = document.createElement("button"); copyBtn.textContent = "Copy";
      const delBtn = document.createElement("button"); delBtn.textContent = "Delete";
      actions.append(copyBtn, delBtn); top.append(title, actions);

      const mono = document.createElement("div"); mono.className = "mono";
      mono.textContent = renderTemplate(item.template, item.fields);

      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(mono.textContent);
        copyBtn.textContent = "Copied"; setTimeout(()=> copyBtn.textContent = "Copy", 900);
      });
      delBtn.addEventListener("click", () => {
        const arr = getSaved(); arr.splice(idx,1); setSaved(arr); populateSavedList(arr);
      });

      li.append(top, mono); list.append(li);
    });
}

function makeFieldMapper(fields){
  const container = document.getElementById("fieldMapper");
  container.innerHTML = "";
  FIELD_KEYS.forEach(key => {
    const row = document.createElement("div"); row.className = "mapper-row";
    const label = document.createElement("label"); label.textContent = key;
    const input = document.createElement("input"); input.placeholder = key; input.value = fields[key] || "";
    input.id = `map-${key}`;
    row.append(label, input); container.append(row);
  });
}

function detectFieldsFromContent(content){
  const asJson = parseMaybeJson(content);
  if(asJson){
    const flat = flattenObject(asJson);
    const lower = Object.fromEntries(Object.entries(flat).map(([k,v]) => [k.toLowerCase(), v]));
    const fields = {};
    function pick(...keys){ for(const k of keys){ if(lower[k] && !fields.name) fields.name = lower[k]; } }
    // naive heuristics
    fields.name = lower["name"] || lower["full_name"] || lower["first_name last_name"] || "";
    fields.email = lower["email"] || lower["contact.email"] || "";
    fields.phone = lower["phone"] || lower["contact.phone"] || "";
    fields.company = lower["company"] || lower["organization"] || lower["org.name"] || "";
    fields.address = lower["address"] || lower["location.address"] || "";
    return fields;
  }

  // HTML?
  if(/<\w+[\s\S]*>/i.test(content)){
    const text = cleanText(extractTextFromHtml(content));
    return guessFieldsFromText(text);
  }

  return guessFieldsFromText(cleanText(content));
}

function wireEvents(){
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const t1Input = document.getElementById("template1Input");
  const parseBtn = document.getElementById("parseBtn");
  const autoParse = document.getElementById("autoParse");
  const detectedPre = document.getElementById("detectedFields");
  const applyMappingBtn = document.getElementById("applyMappingBtn");
  const clearBtn = document.getElementById("clearBtn");
  const t2Editor = document.getElementById("template2Editor");
  const preview = document.getElementById("preview");
  const renderBtn = document.getElementById("renderBtn");
  const saveBtn = document.getElementById("saveBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");

  t2Editor.value = DEFAULT_TEMPLATE_2;

  function parseAndShow(content){
    const fields = detectFieldsFromContent(content);
    detectedPre.textContent = JSON.stringify(fields, null, 2);
    makeFieldMapper(fields);
  }

  ;["dragenter","dragover"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("hover"); }));
  ;["dragleave","drop"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove("hover"); }));
  dropzone.addEventListener("drop", async (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    const contentParts = await Promise.all(files.map(readFileAsText));
    const content = contentParts.join("\n\n");
    t1Input.value = content;
    if(autoParse.checked) parseAndShow(content);
  });

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    const contentParts = await Promise.all(files.map(readFileAsText));
    const content = contentParts.join("\n\n");
    t1Input.value = content;
    if(autoParse.checked) parseAndShow(content);
  });

  t1Input.addEventListener("paste", (e) => {
    setTimeout(() => { if(autoParse.checked) parseAndShow(t1Input.value); }, 0);
  });

  parseBtn.addEventListener("click", () => parseAndShow(t1Input.value));

  applyMappingBtn.addEventListener("click", () => {
    const fields = {};
    FIELD_KEYS.forEach(k => { fields[k] = document.getElementById(`map-${k}`).value.trim(); });
    detectedPre.textContent = JSON.stringify(fields, null, 2);
    preview.textContent = renderTemplate(t2Editor.value, fields);
  });

  clearBtn.addEventListener("click", () => {
    t1Input.value = ""; detectedPre.textContent = ""; document.getElementById("fieldMapper").innerHTML = ""; preview.textContent = "";
  });

  renderBtn.addEventListener("click", () => {
    try{
      const fields = JSON.parse(detectedPre.textContent || "{}");
      preview.textContent = renderTemplate(t2Editor.value, fields);
    }catch{
      preview.textContent = "Invalid detected fields JSON";
    }
  });

  saveBtn.addEventListener("click", () => {
    try{
      const fields = JSON.parse(detectedPre.textContent || "{}");
      const items = getSaved();
      items.unshift({ template: t2Editor.value, fields, createdAt: new Date().toISOString() });
      setSaved(items);
      populateSavedList(items);
    }catch{}
  });

  document.getElementById("search").addEventListener("input", () => populateSavedList(getSaved()));

  exportBtn.addEventListener("click", () => {
    const data = JSON.stringify(getSaved(), null, 2);
    const blob = new Blob([data], {type: "application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "template2-entries.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0]; if(!file) return;
    const text = await readFileAsText(file);
    try{
      const data = JSON.parse(text);
      if(Array.isArray(data)){
        setSaved(data.concat(getSaved()));
        populateSavedList(getSaved());
      }
    }catch{}
  });

  populateSavedList(getSaved());
}

window.addEventListener("DOMContentLoaded", wireEvents);
