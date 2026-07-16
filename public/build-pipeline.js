(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const before=[]; const after=[]; const failed=[]; let installed=false;
  function useBefore(name,handler){before.push({name,handler})}
  function useAfter(name,handler){after.push({name,handler})}
  function useError(name,handler){failed.push({name,handler})}
  async function install(){
    if(installed||typeof request!=='function')return false;
    const original=request;
    request=async function pipelineRequest(editing){
      const field=document.getElementById('prompt');
      const originalPrompt=field?.value||'';
      const context={editing:Boolean(editing),prompt:originalPrompt,currentApp:typeof currentApp==='undefined'?window.currentApp:currentApp,cancelled:false,metadata:{}};
      try{
        for(const item of before){const result=await item.handler(context);if(result===false||context.cancelled)return null;if(result&&typeof result==='object')Object.assign(context,result)}
        if(field&&context.prompt!==originalPrompt)field.value=context.prompt;
        const result=await original(editing);
        context.result=result;context.currentApp=typeof currentApp==='undefined'?window.currentApp:currentApp;
        for(const item of after)await item.handler(context);
        return result;
      }catch(error){context.error=error;for(const item of failed){try{await item.handler(context)}catch(nested){console.warn('AtomOS middleware error',item.name,nested)}}throw error}
      finally{if(field)field.value=originalPrompt}
    };
    request.__atomosPipeline=true;
    const build=document.getElementById('build'),edit=document.getElementById('edit');
    if(build)build.onclick=()=>request(false);if(edit)edit.onclick=()=>request(true);
    installed=true;return true;
  }
  window.AtomOSBuildPipeline={useBefore,useAfter,useError,install,before,after,failed};
  let attempts=0;const timer=setInterval(()=>{attempts++;if(install()||attempts>50)clearInterval(timer)},100);
})();
