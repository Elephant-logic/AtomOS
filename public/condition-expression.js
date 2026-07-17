(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AtomOSCondition=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function tokenize(input){
    const text=String(input??'').trim();
    const tokens=[];
    let i=0;
    while(i<text.length){
      const ch=text[i];
      if(/\s/.test(ch)){i+=1;continue;}
      const op=['===','!==','>=','<=','==','!=','&&','||'].find(value=>text.startsWith(value,i));
      if(op){tokens.push({type:'op',value:op});i+=op.length;continue;}
      if('!><()'.includes(ch)){tokens.push({type:ch==='('? 'lparen':ch===')'?'rparen':'op',value:ch});i+=1;continue;}
      if(ch==='"'||ch==="'"){
        const quote=ch;let value='';i+=1;let closed=false;
        while(i<text.length){
          if(text[i]===quote){closed=true;i+=1;break;}
          if(text[i]==='\\'&&i+1<text.length){i+=1;value+=text[i];i+=1;continue;}
          value+=text[i];i+=1;
        }
        if(!closed)throw new Error(`Unterminated string in condition: ${text}`);
        tokens.push({type:'literal',value});continue;
      }
      const number=text.slice(i).match(/^-?(?:\d+\.?\d*|\.\d+)/);
      if(number){tokens.push({type:'literal',value:Number(number[0])});i+=number[0].length;continue;}
      const ident=text.slice(i).match(/^(?:state\.)?[A-Za-z][A-Za-z0-9_-]{0,39}/);
      if(ident){
        const raw=ident[0];i+=raw.length;
        const lower=raw.toLowerCase();
        if(lower==='true'||lower==='false')tokens.push({type:'literal',value:lower==='true'});
        else if(lower==='null')tokens.push({type:'literal',value:null});
        else if(lower==='and'||lower==='or'||lower==='is')tokens.push({type:'op',value:lower==='and'?'&&':lower==='or'?'||':'=='});
        else tokens.push({type:'identifier',value:raw.replace(/^state\./,''),explicitState:raw.startsWith('state.')});
        continue;
      }
      throw new Error(`Unsupported token in condition: ${text.slice(i)}`);
    }
    return tokens;
  }

  function parse(input){
    const tokens=tokenize(input);let index=0;
    const peek=()=>tokens[index];
    const take=()=>tokens[index++];
    function primary(){
      const token=take();
      if(!token)throw new Error('Condition ended unexpectedly');
      if(token.type==='literal')return {type:'literal',value:token.value};
      if(token.type==='identifier')return {type:'state',key:token.value,explicitState:token.explicitState};
      if(token.type==='lparen'){
        const node=or();
        if(!peek()||take().type!=='rparen')throw new Error('Condition is missing a closing parenthesis');
        return node;
      }
      throw new Error(`Unexpected token in condition: ${token.value}`);
    }
    function unary(){
      if(peek()?.type==='op'&&peek().value==='!'){take();return {type:'not',value:unary()};}
      return primary();
    }
    function comparison(){
      let left=unary();
      const operator=peek()?.type==='op'&&['==','===','!=','!==','>','>=','<','<='].includes(peek().value)?take().value:null;
      if(!operator)return left;
      let right=unary();
      if(right.type==='state'&&!right.explicitState)right={type:'literal',value:right.key};
      left={type:'compare',operator,left,right};
      return left;
    }
    function and(){let node=comparison();while(peek()?.type==='op'&&peek().value==='&&'){take();node={type:'and',left:node,right:comparison()};}return node;}
    function or(){let node=and();while(peek()?.type==='op'&&peek().value==='||'){take();node={type:'or',left:node,right:and()};}return node;}
    if(!tokens.length)throw new Error('Condition cannot be empty');
    const ast=or();
    if(index!==tokens.length)throw new Error(`Unexpected token in condition: ${peek().value}`);
    return ast;
  }

  function stateKeys(ast,result=new Set()){
    if(!ast)return result;
    if(ast.type==='state')result.add(ast.key);
    else if(ast.type==='not')stateKeys(ast.value,result);
    else if(ast.type==='compare'||ast.type==='and'||ast.type==='or'){stateKeys(ast.left,result);stateKeys(ast.right,result);}
    return result;
  }

  function evaluateAst(ast,state){
    if(ast.type==='literal')return ast.value;
    if(ast.type==='state')return state?.[ast.key];
    if(ast.type==='not')return !evaluateAst(ast.value,state);
    if(ast.type==='and')return Boolean(evaluateAst(ast.left,state)&&evaluateAst(ast.right,state));
    if(ast.type==='or')return Boolean(evaluateAst(ast.left,state)||evaluateAst(ast.right,state));
    const left=evaluateAst(ast.left,state),right=evaluateAst(ast.right,state);
    if(ast.operator==='=='||ast.operator==='===')return left===right;
    if(ast.operator==='!='||ast.operator==='!==')return left!==right;
    if(ast.operator==='>')return left>right;
    if(ast.operator==='>=')return left>=right;
    if(ast.operator==='<')return left<right;
    if(ast.operator==='<=')return left<=right;
    return false;
  }

  function evaluate(expression,state){
    if(expression===undefined||expression===null||expression==='')return false;
    return Boolean(evaluateAst(parse(expression),state||{}));
  }

  function extractStateKeys(expression){return [...stateKeys(parse(expression))];}
  return {tokenize,parse,extractStateKeys,evaluate};
});
