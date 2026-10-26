const $=id=>document.getElementById(id), code=$('code'), database=$('database');

let trace=[],pos=0,timer=null,selectedLoop=0,loops=[],loopTrace=[],loopPos=0,loopTimer=null,lastData=null,stdinValues=[],stdinCursor=0;

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

$('themeToggle').addEventListener('click',()=>{
    let light=document.body.dataset.theme!=='light';document.body.dataset.theme=light?'light':'dark';
    $('themeToggle').textContent=light?'☾ Dark theme':'☀ Light theme'
});

document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x===b));
    $('programPage').classList.toggle('active',b.dataset.page==='program');
    $('loopsPage').classList.toggle('active',b.dataset.page==='loops');
    if(b.dataset.page==='loops')renderLoops()
}));

$('clearBtn').addEventListener('click',()=>{
    code.value='';trace=[];pos=0;stdinValues=[];
    stdinCursor=0;renderPreview();stopAll();
    $('iterate').classList.remove('visible')
});

$('saveBtn').addEventListener('click',saveCode);

function saveCode(){
    const blob=new Blob([code.value],{
        type:'text/x-csrc;charset=utf-8'
    }),url=URL.createObjectURL(blob),a=document.createElement('a');

    a.href=url;a.download='dsa_program.c';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000)
}

code.addEventListener('keydown',e=>{
    if(e.key==='Tab'){
        e.preventDefault();
        const s=code.selectionStart,en=code.selectionEnd;
        const val=code.value;
        if(s===en){
            code.setRangeText('    ',s,en,'end')
        }else{
            const before=val.slice(0,s),start=before.lastIndexOf('\n')+1;
            const endLine=val.indexOf('\n',en);
            const end=endLine<0?val.length:endLine;
            const chunk=val.slice(start,end).split('\n').map(x=>'    '+x).join('\n');
            
            code.setRangeText(chunk,start,end,'select');
            code.selectionStart=start;
            code.selectionEnd=start+chunk.length}renderPreview();
            
            return
        }

    if(e.key==='s'&&(e.ctrlKey||e.metaKey)){
        e.preventDefault();saveCode();
        return
    }
    
    const pairs={'(':')','[':']','{':'}','"':'"',"'" :"'"};
    const s=code.selectionStart,en=code.selectionEnd;
 
    if(pairs[e.key]){
        e.preventDefault();
        const selected=code.value.slice(s,en);
        code.setRangeText(e.key+selected+pairs[e.key],s,en,'end');
        code.selectionStart=s+1;
        code.selectionEnd=s+1+selected.length;
        renderPreview();
        return;
    }

    if (e.key === 'Backspace' && s === en) {
        const pair = {
            ')': '(',
            ']': '[',
            '}': '{',
            '"': '"',
            "'": "'"
        };

        const next = code.value[s];
        const prev = code.value[s - 1];

        if (pair[next] && prev === pair[next]) {
            e.preventDefault();
            code.setRangeText('', s - 1, s + 1, 'end');
            renderPreview();
            return;
        }
    }

    if(e.key==='Enter'){
        const s0=code.selectionStart,en0=code.selectionEnd,before=code.value.slice(0,s0),line=before.split('\n').pop(),indent=(line.match(/^\s*/)||[''])[0],after=code.value.slice(s0);
        e.preventDefault();
        if (/\{\s*$/.test(line) && /^\s*}/.test(after)) {
            const bodyIndent = indent + '    ';

            code.setRangeText(
                '\n' + bodyIndent + '\n' + indent,
                s0,
                en0,
                'end'
            );

            code.selectionStart = s0 + 1 + bodyIndent.length;
            code.selectionEnd = code.selectionStart;

            renderPreview();
            return;
        }

        let base=indent;
        if(/[\{\[(]\s*$/.test(line))
            base+='    ';

        if(/^\s*}/.test(after)&&base.length>=4)
            base=base.slice(0,base.length-4);

        code.setRangeText('\n'+base,s0,en0,'end');
        renderPreview();
        return
    }
});

let editRebuildQueued=false;
code.addEventListener('input',()=>{
    renderPreview();
    if(!editRebuildQueued){
        editRebuildQueued=true;
        queueMicrotask(()=>{
            editRebuildQueued=false;
            if(code.value.trim()){
                const result=buildTrace(true);
                if(!result){
                    trace=[];pos=0;updateGutter(0);
                }
            }else{
                trace=[];pos=0;stdinValues=[];stopAll();
                $('traceMsg').textContent='Press Run to simulate supported C statements.';
                $('history').textContent='No execution history yet.';
                $('terminal').textContent='dsa@visual-lab:~$ ./program\\nWaiting to run your program…';
            }
        });
    }
});

code.addEventListener('scroll',()=>$('gutter').scrollTop=code.scrollTop);

function updateGutter(activeLine=0){
    const n=Math.max(1,code.value.split('\n').length);
    $('gutter').innerHTML=Array.from({length:n},(_,i)=>`<div class="${i+1===activeLine?'active':''}">${i+1}</div>`).join('');
    $('gutter').scrollTop=code.scrollTop;
}

function stripComments(src){
    return src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')
}

function parsePreview(src){
    const vars=new Map(),arrays=[],refs=[];let m;src=stripComments(src);
    // declarations; supports comma-separated scalar declarations
    const arrayRx=/\b(char|short|int|long|float|double|bool)\s+([A-Za-z_]\w*)\s*\[\s*(?:(\d+)\s*)?\]\s*(?:=\s*\{([^}]*)\})?/g;
    while((m=arrayRx.exec(src))!==null){
        let vals=m[4]!==undefined?(m[4].trim()?m[4].split(',').map(parseLiteral):[]):Array(m[3]?Number(m[3]):0).fill('');
        const name=m[2];
        if(!arrays.some(a=>a.name===name)){
            arrays.push({
                name,type:m[1],values:vals
            });
            vars.set(name,{
                type:m[1]+'[]',value:`${vals.length} elements`,kind:'array'
            });
        }
    }
    
    const scalarRx=/\b(char|short|int|long|float|double|bool)\s+([^;{}]+);/g;
    while((m=scalarRx.exec(src))!==null){
        const type=m[1],decls=splitComma(m[2]);
        for(const decl of decls){
            const d=decl.trim().match(/^([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/);
            if(!d||arrays.some(a=>a.name===d[1]))continue;
            vars.set(d[1],{type,value:d[2]===undefined?'':parseLiteral(d[2].trim()),kind:'scalar'});
        }
    }
    
    const loopRx=/\bfor\s*\(\s*(?:(int|long|short|char)\s+)?([A-Za-z_]\w*)\s*=\s*(-?\d+)/g;
    while((m=loopRx.exec(src))!==null)
        if(!vars.has(m[2]))vars.set(m[2],{type:m[1]||'int',value:Number(m[3]),kind:'loop'});
 
    const refRx=/\b([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]/g;
    while((m=refRx.exec(src))!==null){
        const a=arrays.find(x=>x.name===m[1]);
        if(!a)continue;const expr=m[2].trim();
        let idx=null;
        if(vars.has(expr)&&Number.isFinite(Number(vars.get(expr).value)))idx=Number(vars.get(expr).value);
        else if(/^-?\d+$/.test(expr))idx=Number(expr);
        else{const p=expr.match(/^([A-Za-z_]\w*)\s*([+-])\s*(\d+)$/);
            if(p&&vars.has(p[1]))idx=Number(vars.get(p[1]).value)+(p[2]==='+'?1:-1)*Number(p[3]);
        }
        if(!refs.some(r=>r.array===m[1]&&r.expr===expr))refs.push({array:m[1],expr,index:idx})
    }
 return {vars,arrays,refs};
}

function splitComma(s){
    let out=[],cur='',depth=0,q='';
    
    for(let c of s){
        if(q){
            cur+=c;
            if(c===q)q='';
            continue
        }
    
        if(c==='"'||c==="'"){
            q=c;
            cur+=c
        }else if('([{'.includes(c)){
            depth++;cur+=c
        }else if(')]}'.includes(c)){
            depth--;cur+=c
        }else if(c===','&&depth===0){
            out.push(cur);cur=''
        }else cur+=c
    }
    
    if(cur.trim())out.push(cur);
    return out
}

function parseLiteral(s){
    s=String(s).trim();
    if(/^'.*'$/.test(s)||/^".*"$/.test(s))
        return s.slice(1,-1);
    
    if(s==='true')
        return true;
    
    if(s==='false')
        return false;
    
    const n=Number(s);
    return s!==''&&Number.isFinite(n)?n:s
}

function renderMemory(data,traceStep=null){
 const vars=[...data.vars.entries()].filter(([n,v])=>v.kind!=='array');
 
 let html='';if(vars.length)html+=`<section><div class="section-title">Variables</div><div class="vars">${
    vars.map(([n,v])=>`<div class="var"><div class="name">${
        esc(n)
    }</div><div class="value">${
        v.value===''?'&nbsp;':esc(v.value)
    }
    </div><div class="type">${
        esc(v.type)
    }${v.kind==='loop'?' · loop counter':''}</div></div>`).join('')}</div></section>`;
    
    if(data.arrays.length)html+=`<section><div class="section-title">Arrays · contiguous cells</div>${
        data.arrays.map(a=>`<div class="array-wrap"><div class="array-name">${
            esc(a.name)
        } <span class="hint">(${
            esc(a.type)
        }[${a.values.length}])</span></div><div class="array-cells">${
            a.values.map((v,i)=>`<div class="cell ${
                data.refs.some(r=>r.array===a.name&&r.index===i)?'target':''
            } ${
                traceStep?.indices?.includes(i)&&traceStep.arrayName===a.name?'target':''
            }"><div class="index">index ${
                i
            }</div><div class="value">${
                v===''?'&nbsp;':esc(v)
            }</div></div>`).join('')

        }</div><div class="pointers">${
            data.refs.filter(r=>r.array===a.name).map(r=>`<div class="pointer"><strong>${
                esc(a.name)
            }[${
                esc(r.expr)
            }]</strong><span class="arrow"> → </span>${
                r.index!==null&&r.index>=0&&r.index<a.values.length?`index ${r.index} (value ${esc(a.values[r.index])})`:'index unresolved'
            }</div>`).join('')||'<span class="hint">No index references detected yet.</span>'
        }</div></div>`).join('')}</section>`;

    if(!html)
        html='<div class="empty"><div><strong>No variables detected</strong>Try int a = 10; or int arr[] = {1, 2, 3};</div></div>';

    return html;
}

function renderPreview(){

    const src=code.value;updateGutter(trace[pos]?.line||0);
    if(!src.trim()){
        database.className='empty';
        database.innerHTML='<div><strong>Memory is empty</strong>Enter code on the left.<br>Detected variables and arrays will appear here.</div>';
        $('itemCount').textContent='No data yet';
        $('parseError').textContent='';
        $('iterate').classList.remove('visible');
        loops=[];
        renderLoops();
        return;
    }

    const data=parsePreview(src);
    lastData=data;database.className='pane db';database.innerHTML=renderMemory(data);
    $('itemCount').textContent=`${data.vars.size} variable${data.vars.size===1?'':'s'} · ${data.arrays.length} array${data.arrays.length===1?'':'s'}`;
    $('parseError').textContent='';
    $('iterate').classList.add('visible');detectLoops(src)
}

function detectLoops(src){
        
    const lines=stripComments(src).split('\n');loops=[];
    for(let i=0;i<lines.length;i++){

        const s=lines[i].trim();
        const m=s.match(/\b(for|while|do)\b\s*(?:\((.*)\))?/);

        if(m){
            let depth=0,started=false,end=i;
            for(let j=i;j<lines.length;j++){
                for(const ch of lines[j]){
                    if(ch==='{'){
                        depth++;started=true
                    }else if(ch==='}')
                        depth--
                }
                
                if(started&&depth<=0&&j>i){
                    end=j;
                    break
                }
                
                if(!started&&j>i){
                    end=j;
                    break
                }
            }
            
            loops.push({
                index:loops.length,line:i+1,endLine:end+1,type:m[1],header:s,condition:m[2]||'',source:lines.slice(i,end+1).join('\n')
            })
        }
    }

    renderLoops()
}

function tokenize(expr){
    const tokens=[],rx=/\s*(\+\+|--|<=|>=|==|!=|&&|\|\||[A-Za-z_]\w*|\d+(?:\.\d+)?|[()+\-*/%<>=!&\[\]])/gy;
    let p=0;
    while(p<expr.length){
        rx.lastIndex=p;
        
        const m=rx.exec(expr);
        if(!m){
            if(expr.slice(p).trim()==='')
                break;

            throw Error('Unsupported expression near: '+expr.slice(p))
        }
        tokens.push(m[1]);p=rx.lastIndex
    }
    return tokens
}

function evalExpr(expr,env){
    const t=tokenize(expr);
    let p=0;
    const prec={'||':1,'&&':2,'==':3,'!=':3,'<':4,'>':4,'<=':4,'>=':4,'+':5,'-':5,'*':6,'/':6,'%':6};
    
    function atom(){
        const x=t[p++];
        if(x===undefined)
            throw Error('Unexpected end of expression');
        if(x==='('){const v=bin(0);if(t[p++]!==')')throw Error('Missing )');return v}
        if(x==='!'||x==='-'||x==='+'){const v=atom();return x==='!'?!v:x==='-'?-v:+v}
        if(/^\d/.test(x))return Number(x);
        if(x==='true')return true;
        if(x==='false')return false;
        if(/^[A-Za-z_]/.test(x)){
            if(t[p]==='['){
                p++;
                const ix=bin(0);
                if(t[p++]!==']')throw Error('Missing ]');
                return env.arrays.get(x)?.[Number(ix)]??0;
            }
            return env.vars.has(x)?env.vars.get(x):0;
        }
        throw Error('Unexpected token '+x)
    }

    function bin(min){
        let left=atom();
        while(p<t.length&&prec[t[p]]>=min){
            const op=t[p++],pr=prec[op],right=bin(pr+1);
            switch(op){
                case'||':
                    left=left||right;
                    break;
                case'&&':
                    left=left&&right;
                    break;
                case'==':
                    left=left==right;
                    break;
                case'!=':
                    left=left!=right;
                    break;
                case'<':
                    left=left<right;
                    break;
                case'>':
                    left=left>right;
                    break;
                case'<=':
                    left=left<=right;
                    break;
                case'>=':
                    left=left>=right;
                    break;
                case'+':
                    left=Number(left)+Number(right);
                    break;
                case'-':
                    left=Number(left)-Number(right);
                    break;
                case'*':
                    left=Number(left)*Number(right);
                    break;
                case'/':
                    left=Number(left)/Number(right);
                    break;
                case'%':
                    left=Number(left)%Number(right);
                    break;
            }
        }
        return left
    }

    const val=bin(0);
    if(p<t.length)
        throw Error('Unsupported expression near '+t.slice(p).join(' '));
    
    return val
}

function normalizeLines(src) {
    const out = [];
    let initializerCount = 0;
    const initializers = new Map();
    const normalizedSource = stripComments(src).split('\n');

    normalizedSource.forEach((raw, idx) => {
        let trimmed = raw.trim();

        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }

        trimmed = trimmed.replace(/(\[\s*(?:\d+\s*)?\]\s*=\s*)\{([^{}]*)\}/g,(match) => {
            const key = `__ARRAY_INITIALIZER_${initializerCount++}__`;
            initializers.set(key, match);
            return key;
        });

        const chunks = trimmed.replace(/\{/g, '\n{\n').replace(/\}/g, '\n}\n').split('\n').map(text => text.trim()).filter(Boolean);

        for (let text of chunks) {
            for (const [key, original] of initializers) {
                if (text.includes(key)) {
                    text = text.replace(key, original);
                }
            }

            out.push({text,line: idx + 1});
        }
    });

    return out;
}

function splitTop(s,sep){
    let depth=0,q='',cur='',out=[];
    for(const c of s){
        if(q){
            cur+=c;
            if(c===q)q='';
            continue
        }if(c==='"'||c==="'"){
            q=c;
            cur+=c
        }else if('([{'.includes(c)){
            depth++;
            cur+=c
        }else if(')]}'.includes(c)){
            depth--;
            cur+=c
        }else if(c===sep&&depth===0){
            out.push(cur.trim());
            cur=''
        }else
            cur+=c
    }
    out.push(cur.trim());
    return out
}

function runProgram(source,onlyLoop=null){
    const lines=normalizeLines(source),env={vars:new Map(),types:new Map(),arrays:new Map()},steps=[],maxSteps=10000;
    
    function snap(line, msg, indices = null, arrayName = null, extra = {}) {
        if (onlyLoop && (line < onlyLoop.line || line > onlyLoop.endLine)) {
            return;
        }

        const vars = Object.fromEntries(env.vars);
        const arrays = [...env.arrays].map(([name, values]) => ({name,values: [...values]}));

        steps.push({line,msg,vars,arrays,indices,arrayName,...extra});

        if (steps.length > maxSteps) {
            throw Error('Execution stopped: step limit reached (possible infinite loop).');
        }
    }

    function parseDecl(s,line){
        const m=s.match(/^(char|short|int|long|float|double|bool)\s+(.+);?$/);
        if(!m)
            return false;
        
        const type=m[1],created=[];
        for(const d of splitTop(m[2].replace(/;$/,''),',')){
            const a=d.match(/^([A-Za-z_]\w*)\s*\[\s*(?:(\d+)\s*)?\]\s*(?:=\s*\{(.*)\})?$/);
            if(a){
                const vals=a[3]!==undefined?(a[3].trim()?splitTop(a[3],',').map(x=>evalExpr(x,env)):[]):Array(a[2]?Number(a[2]):0).fill('');env.arrays.set(a[1],vals);
                env.types.set(a[1],type+'[]');
                created.push(`${a[1]}[${vals.length}]`);
                continue
            }
            
            const v=d.match(/^([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/);
            if(!v)
                throw Error('Cannot parse declaration: '+d);
            
            let value=v[2]!==undefined?evalExpr(v[2],env):'';
            env.vars.set(v[1],value);
            env.types.set(v[1],type);
            created.push(`${v[1]}${v[2]!==undefined?' = '+value:' (uninitialized)'}`)}snap(line,`Declare together: ${created.join(', ')}.`);
            return true
        }
    
    function assign(s,line){
        let x=s.replace(/;$/,'').trim();
        
        if(x==='')return false;
        if(/^(return|break|continue)\b/.test(x)){
            snap(line,x);
            return x
        }
    
        let m=x.match(/^([A-Za-z_]\w*)\s*(\+\+|--)\s*$/);
        if(m){
            // Increment or decrement a variable
            let old=Number(env.vars.get(m[1])||0);
            env.vars.set(m[1],old+(m[2]==='++'?1:-1));
            snap(line,`${m[1]} ${m[2]} → ${env.vars.get(m[1])}.`);
            return true
        }

        m=x.match(/^([A-Za-z_]\w*)\s*([+\-])=\s*(.+)$/);
        if(m){
            let v=evalExpr(m[3],env),old=Number(env.vars.get(m[1])||0);
            env.vars.set(m[1],old+(m[2]==='+'?1:-1)*Number(v));
            snap(line,`${m[1]} = ${env.vars.get(m[1])}.`);
            return true
        }
       
        m=x.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
        if(m){
            let val=evalExpr(m[2],env);
            env.vars.set(m[1],val);
            snap(line,`${m[1]} = ${val}.`);
            return true
        }
        m=x.match(/^([A-Za-z_]\w*)\s*\[\s*(.+?)\s*\]\s*=\s*(.+)$/);
        if(m){
            const arr=env.arrays.get(m[1]);
            if(!arr)throw Error('Unknown array '+m[1]);
            const ix=Number(evalExpr(m[2],env)),val=evalExpr(m[3],env);
            if(ix<0||ix>=arr.length)throw Error('Array index out of bounds: '+m[1]+'['+ix+']');
            arr[ix]=val;
            snap(line,`${m[1]}[${ix}] = ${val}.`,[ix],m[1]);
            return true
        }
        return false
    }

    function findClose(start){
        let d=0;
        for(let i=start;i<lines.length;i++){
            if(lines[i].text==='{')d++;
            if(lines[i].text==='}') {
                d--;
                if(d===0)return i;
            }
        }
        return start;
    }

    function parseBlock(start,end,loopFilter=null){
        let i=start;
        while(i<end){
            let x=lines[i],s=x.text;
            if(!s||s==='{'||s==='}') {
                i++;
                continue
            }

            if(/^for\s*\(/.test(s)){
                const h=s.match(/^for\s*\((.*)\)\s*$/);
                if(!h)
                    throw Error('Write the for-loop header on one line.');
                
                const parts=splitTop(h[1],';');
                if(parts.length!==3)
                    throw Error('For loop needs initialization; condition; update.');
                
                let bodyStart=i+1,bodyEnd=bodyStart;
                if(lines[bodyStart]?.text==='{'){
                    bodyEnd=findClose(bodyStart);
                    bodyStart++;
                }else
                    bodyEnd=bodyStart+1;
    
                const isTarget = !onlyLoop || onlyLoop.line === x.line;
                if (parts[0]) {
                    if (!parseDecl(parts[0] + ';', x.line)) {
                        assign(parts[0], x.line);
                    }
                }

                if (isTarget) {
                    snap(x.line, 'For-loop initialization: ' + parts[0]);
                }

                let count=0;
                while(!parts[1]||evalExpr(parts[1],env)){
                    if(++count>1000)
                        throw Error('Loop iteration limit reached.');
                    if(isTarget)
                        snap(x.line,'Check condition '+parts[1]+' → true.');
                    
                    const r=parseBlock(bodyStart,bodyEnd,loopFilter);
                    if(r==='break')
                        break;
                    
                    if(r==='return'||r==='input')
                        return r;
                    
                    if(parts[2])
                        assign(parts[2],x.line);
                    
                    if(isTarget)
                        snap(x.line,'For-loop update: '+parts[2]);
                }
                if(isTarget)
                    snap(x.line,'Loop finished: condition is false.');
                i=bodyEnd+1;
                continue
            }
            
            if(/^while\s*\(/.test(s)){
                const h=s.match(/^while\s*\((.*)\)\s*$/);
                if(!h)
                    throw Error('Write the while condition on one line.');
                
                let bs=i+1,be=bs;
                if(lines[bs]?.text==='{'){
                    be=findClose(bs);bs++
                }else
                    be=bs+1;
                    
                let c=0;
                while(evalExpr(h[1],env)){
                    if(++c>1000)
                        throw Error('Loop iteration limit reached.');
                    
                    snap(x.line,'While condition '+h[1]+' → true.');
                    const r=parseBlock(bs,be,loopFilter);
                    if(r==='break')
                        break;

                    if(r==='return'||r==='input')
                        return r
                }
                snap(x.line,'While condition is false; loop finished.');
                i=be+1;
                continue
            }

            if(/^if\s*\(/.test(s)){
                const h=s.match(/^if\s*\((.*)\)\s*$/);
                if(!h)
                    throw Error('Write the if condition on one line.');
                
                let bs=i+1,be=bs;
                if(lines[bs]?.text==='{'){
                    be=findClose(bs);
                    bs++
                }else
                    be=bs+1;
                    
                if(evalExpr(h[1],env)){
                    snap(x.line,'If condition '+h[1]+' → true.');
                    
                    const r=parseBlock(bs,be,loopFilter);
                    if(r==='return'||r==='input')
                        return r
                }else
                    snap(x.line,'If condition '+h[1]+' → false.');
                    i=be+1;continue
            }
            
            if(/^else\b/.test(s)){
                i++;
                continue
            }
            
            if(/^printf\s*\(/.test(s)){
                const fm=s.match(/^printf\s*\(\s*"((?:\\.|[^"])*)"(?:\s*,\s*(.*))?\s*\)\s*;?$/);
                if(!fm){
                    snap(x.line,'printf statement detected (complex format not simulated).');
                    i++;
                    continue
                }
                
                const args=fm[2]?splitTop(fm[2],',').map(a=>evalExpr(a,env)):[];
                let ai=0,out=fm[1].replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/%[-+0-9.]*[diuoxXfFeEgGc s]/g,token=>{
                    if(token==='%%')
                        return '%';
                
                const v=args[ai++];
                return v===undefined?'':String(v)
                }).replace(/%%/g,'%');snap(x.line,'Program output: '+out,null,null,{terminalOutput:out});
                i++;continue
            }
            
            if(/^scanf\s*\(/.test(s)){
                const targets=[...s.matchAll(/&\s*([A-Za-z_]\w*)\s*(?:\[\s*([^\]]+)\s*\])?/g)].map(m=>({name:m[1],index:m[2]}));
                if(stdinCursor>=stdinValues.length){
                    snap(x.line,'Waiting for input at scanf().',null,null,{inputRequired:true,targets});
                    return 'input'
                }
                
                const raw=stdinValues[stdinCursor++],values=String(raw).trim().split(/\s+/).filter(Boolean);
                let consumed=0;
                for(const t of targets){
                    const token=values[consumed++]??'0',val=Number.isFinite(Number(token))?Number(token):token;
                    if(t.index!==undefined){
                        const arr=env.arrays.get(t.name);
                        if(!arr)
                            throw Error('scanf target array '+t.name+' does not exist');

                        const ix=Number(evalExpr(t.index,env));
                        if(ix<0||ix>=arr.length)
                            throw Error('scanf array index out of bounds: '+t.name+'['+ix+']');

                        arr[ix]=val;
                        snap(x.line,`scanf input stored: ${t.name}[${ix}] = ${val}.`,[ix],t.name,{terminalInput:raw});
                    }else{
                        env.vars.set(t.name,val);
                        snap(x.line,`scanf input stored: ${t.name} = ${val}.`,null,null,{terminalInput:raw});
                    }
                }
                i++;continue
            }
            
            if(/^int\s+main\s*\(/.test(s)||/^\w+\s+\w+\s*\(.*\)$/.test(s)){
                i++;
                continue
            }
            
            if(s==='return 0;'||s==='return;'){
                snap(x.line,s);
                return 'return'
            }
            
            if(!parseDecl(s,x.line)&&!assign(s,x.line)&&!/^#|^printf|^scanf/.test(s)) {
                if(s.endsWith(';'))
                    snap(x.line,'Statement not simulated: '+s)
            }
            
            i++
        }
        return null
    }

    // Locate main body; otherwise execute declarations/statements as written.
    let start=0;
    const mainIdx=lines.findIndex(x=>/^int\s+main\s*\(/.test(x.text));
    if(mainIdx>=0){
        let brace=mainIdx;
        while(brace<lines.length&&lines[brace].text!=='{')
            brace++;

        if(brace<lines.length)
            start=brace+1
        }

    parseBlock(start,lines.length,onlyLoop);return {steps,env}
}

function stopAll(){
    if(timer){
        clearInterval(timer);
        timer=null
    }
    
    if(loopTimer){
        clearInterval(loopTimer);
        loopTimer=null
    }
    
    $('playBtn').textContent='▶ Autoplay';
    $('loopPlay').textContent='▶ Autoplay'
}

function buildTrace(loop=null,keepPosition=false){
    stopAll();
    try{
        const oldLine=keepPosition?(trace[pos]?.line||1):1;
        stdinCursor=0;
        const result=runProgram(code.value,loop);
        trace=result.steps;
        pos=keepPosition?trace.findIndex(x=>x.line>=oldLine):0;
        if(pos<0)
            pos=Math.max(0,trace.length-1);

        $('iterate').classList.add('visible');
        if(!trace.length){
            $('traceMsg').textContent='No executable statements found.';
            $('history').textContent='No steps';
            return result
        }

        renderStep();
        $('parseError').textContent='';
        return result
    }catch(e){
        $('parseError').textContent=e.message;
        $('traceMsg').textContent='Could not build trace. Check the supported C syntax.';
        $('traceCode').textContent=e.message;
        $('stdinInput').disabled=true;
        $('submitInput').disabled=true;
        return null
    }
}

function renderStep(){
    const s=trace[pos];
    if(!s)
        return;

    $('stepLabel').textContent=`Step ${pos+1} / ${trace.length}`;
    $('traceMsg').textContent=s.msg;
    $('traceCode').textContent=`Source line ${s.line}: ${code.value.split('\n')[s.line-1]||''}`;
    
    const mem={
        vars:new Map(Object.entries(s.vars).map(([k,v])=>[k,{
            value:v,type:'variable'
        }])),arrays:s.arrays.map(a=>({
            name:a.name,type:'int',values:a.values
        })),refs:[]
    };

    database.className='pane db';
    database.innerHTML=renderMemory(mem,{indices:s.indices,arrayName:s.arrayName});
    
    $('itemCount').textContent=`${mem.vars.size} variables · ${mem.arrays.length} arrays`;
    updateGutter(s.line);
    $('prevBtn').disabled=$('firstBtn').disabled=pos===0;
    $('nextBtn').disabled=$('lastBtn').disabled=pos===trace.length-1;
    $('playBtn').disabled=trace.length<2;

    const terminalLines=['dsa@visual-lab:~$ ./program'];
    trace.slice(0,pos+1).forEach(x=>{
        if(x.terminalInput)
            terminalLines.push(x.terminalInput);

        if(x.terminalOutput)
            terminalLines.push(x.terminalOutput);

        if(x.inputRequired)
            terminalLines.push('scanf waiting for input…')
    });

    if(pos===trace.length-1&&!s.inputRequired)
        terminalLines.push('Program simulation finished.');

    $('terminal').textContent=terminalLines.join('\n');
    $('terminal').scrollTop=$('terminal').scrollHeight;
    $('stdinInput').disabled=!s.inputRequired;
    $('submitInput').disabled=!s.inputRequired;
    $('inputPrompt').textContent=s.inputRequired?'Input required by scanf()':'Program input (for scanf)';
    $('stdinInput').placeholder=s.inputRequired?'Enter requested value(s)':'Run code to enable input';
    if(s.inputRequired)
        $('stdinInput').focus();

    $('history').innerHTML=trace.slice(0,pos+1).map((x,i)=>`<div class="history-item"><strong>#${i+1} · L${x.line}</strong><br>${esc(x.msg)}</div>`).join('');
    $('nextBtn').textContent=s.inputRequired?'Continue after input ▶':'Next ▶';
    if(s.inputRequired)
        $('nextBtn').disabled=false
}

function step(n){
    if(!trace.length)
        return;
    
    pos=Math.max(0,Math.min(trace.length-1,n));
    renderStep()
}

$('runBtn').addEventListener('click',()=>{
    stdinValues=[];
    stdinCursor=0;
    $('terminal').textContent='dsa@visual-lab:~$ ./program';
    buildTrace()
});

$('firstBtn').addEventListener('click',()=>step(0));

$('prevBtn').addEventListener('click',()=>step(pos-1));

$('nextBtn').addEventListener('click',()=>{
    if(trace[pos]?.inputRequired){$('stdinInput').focus();
    return}step(pos+1)
});

$('lastBtn').addEventListener('click',()=>step(trace.length-1));

$('inputForm').addEventListener('submit',e=>{
    e.preventDefault();
    const v=$('stdinInput').value.trim();
    if(!v||!trace[pos]?.inputRequired)
        return;stdinValues.push(v);
    
    $('terminal').textContent+='\\n'+v;
    $('stdinInput').value='';
    buildTrace(false);
    if(trace.length)
        step(trace.length-1)
});

$('playBtn').addEventListener('click',()=>{
    if(timer){
        clearInterval(timer);
        timer=null;
        $('playBtn').textContent='▶ Autoplay';
        return
    }
    
    if(!trace.length)
        return;
    
    if(pos>=trace.length-1)
        step(0);
    
    $('playBtn').textContent='Ⅱ Pause';
    
    timer=setInterval(()=>{
        if(pos>=trace.length-1){
            stopAll();
            return
        }
        
        if(trace[pos]?.inputRequired){
            stopAll();
            $('stdinInput').focus();
            return
        }
        
        step(pos+1)
    },$('speed').value==='fast'?250:900)});
    
    document.addEventListener('keydown',e=>{
        if(e.ctrlKey||e.metaKey||e.altKey)
            return;
            
        const tag=(e.target?.tagName||'').toLowerCase();
        if(tag==='textarea'||tag==='input'||tag==='select'||e.target?.isContentEditable)
            return;
        
        if(e.key.toLowerCase()==='n'){
            e.preventDefault();
            if(trace[pos]?.inputRequired)
                $('stdinInput').focus();
            else
                step(pos+1)
        }
        if(e.key.toLowerCase()==='p'){
            e.preventDefault();
            step(pos-1)
        }
    });
    
    function renderLoops(){
        const list=$('loopList');
        $('loopCount').textContent=`${loops.length} loop${loops.length===1?'':'s'} found`;
        if(!loops.length){
            list.innerHTML='<div class="empty"><div><strong>No loops detected</strong>Enter a for, while, or do-while loop in the editor.</div></div>';
            $('loopDetail').className='empty';
            $('loopDetail').innerHTML='<div><strong>Select a loop</strong>The selected loop and its detected variables will be shown here.</div>';
            return
        }
        
        list.innerHTML=loops.map((l,i)=>`<button class="loop-choice ${i===selectedLoop?'active':''}" data-loop="${i}">Loop ${i+1} · ${l.type} (line ${l.line})\n${esc(l.header)}</button>`).join('');
        list.querySelectorAll('[data-loop]').forEach(b=>b.addEventListener('click',()=>{
            selectedLoop=Number(b.dataset.loop);
            renderLoops()
        }));
        const l=loops[Math.min(selectedLoop,loops.length-1)];

        $('loopDetail').className='tracebox';

        $('loopDetail').innerHTML=`<h3>${l.type.toUpperCase()} LOOP · LINE ${l.line}</h3><div class="trace-msg">${esc(l.header)}</div><pre class="trace-code">${esc(l.source)}</pre><p class="hint">Loop body: lines ${l.line}–${l.endLine}. Use Run selected loop to build its execution trace.</p>`
    }

    $('loopRun').addEventListener('click',()=>{
        if(!loops.length)
            return;
        
        const l=loops[selectedLoop];
        const result=buildTrace(l);
        if(result){
            loopTrace=trace.map(x=>({...x}));loopPos=0;renderLoopStep()
        }
    });

    function renderLoopStep() {
        if (!loopTrace.length) return;

        const s = loopTrace[loopPos];
        const preview = parsePreview(code.value);

        // Build variable boxes using the current execution snapshot.
        const vars = new Map(
            Object.entries(s.vars).map(([name, value]) => [
                name,
                {
                    type: preview.vars.get(name)?.type || 'int',
                    value,
                    kind: 'scalar'
                }
            ])
        );

        // Use the current array values from the execution snapshot.
        const arrays = s.arrays.map(array => ({
            name: array.name,
            type: preview.arrays.find(item => item.name === array.name)?.type || 'int',
            values: array.values
        }));

        // Resolve array references using the current variable values.
        const env = {
            vars: new Map(Object.entries(s.vars)),
            arrays: new Map(arrays.map(array => [array.name, array.values]))
        };

        const refs = preview.refs.map(ref => {
            let index = null;

            try {
                const resolved = Number(evalExpr(ref.expr, env));
                if (Number.isFinite(resolved)) index = resolved;
            } catch {
                // Keep the reference unresolved if its expression is unsupported.
            }

            return { ...ref, index };
        });

        // Render the same memory representation used on the main page.
        const memory = { vars, arrays, refs };

        $('loopMemory').className = 'pane db loop-memory';
        $('loopMemory').style.marginTop = '12px';
        $('loopMemory').innerHTML = `
            <div class="panehead">
                <h2>Database / Memory</h2>
                <span class="count">
                    ${vars.size} variables · ${arrays.length} arrays
                </span>
            </div>
            ${renderMemory(memory, {
                indices: s.indices,
                arrayName: s.arrayName
            })}
        `;

        // Keep the current operation and source line visible.
        $('loopTrace').innerHTML = `
            <h3>Step ${loopPos + 1} / ${loopTrace.length}</h3>
            <div class="trace-msg">${esc(s.msg)}</div>
            <div class="trace-code">
                Source line ${s.line}:
                ${esc(code.value.split('\n')[s.line - 1] || '')}
            </div>
            <div class="status">
                Variables:
                ${esc(
                    Object.entries(s.vars)
                        .map(([name, value]) => `${name} = ${value}`)
                        .join(', ')
                )}
            </div>
        `;

        $('loopPrev').disabled = loopPos === 0;
        $('loopNext').disabled = loopPos === loopTrace.length - 1;
        $('loopPlay').disabled = loopTrace.length < 2;
    }

$('loopPrev').addEventListener('click',()=>{
    loopPos=Math.max(0,loopPos-1);
    renderLoopStep()
});

$('loopNext').addEventListener('click',()=>{
    loopPos=Math.min(loopTrace.length-1,loopPos+1);
    renderLoopStep();
});
    
$('loopPlay').addEventListener('click',()=>{
    if(loopTimer){clearInterval(loopTimer);
        loopTimer=null;
        $('loopPlay').textContent='▶ Autoplay';
        return
    }
    $('loopPlay').textContent='Ⅱ Pause';
    loopTimer=setInterval(()=>{
        if(loopPos>=loopTrace.length-1){
            clearInterval(loopTimer);
            loopTimer=null;
            $('loopPlay').textContent='▶ Autoplay';
            return
        }
        loopPos++;
        renderLoopStep();
    },$('speed').value==='fast'?250:900)
});

renderPreview();
