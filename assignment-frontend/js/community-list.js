// List-only discovery UI. Existing app.js owns list filters, authentication and mutations.
window.communityList = (() => {
  const storageKey='revcc:recent-posts:v1';
  const headings={
    '':['전체 게시글','차를 좋아하는 사람들의 이야기, 궁금한 점과 경험을 함께 나눠보세요.'],
    free:['자유게시판','자동차와 관련된 모든 이야기를 자유롭게 나누는 공간입니다.'],
    maintenance:['정비 / DIY','정비 경험과 직접 관리하는 노하우를 나눠보세요.'],
    parts:['부품 이야기','부품 선택부터 장착 후기까지, 함께 이야기해요.'],
    drive:['드라이브','좋았던 길과 함께 달리고 싶은 순간을 공유해요.']
  };
  let refreshMiniGarage;
  const isList=()=>!!document.querySelector('#community-left')&&!/^\/community\/(free|maintenance|parts|drive)\/\d+$/.test(location.pathname);
  function recent(){
    try{const data=JSON.parse(localStorage.getItem(storageKey)||'[]');if(!Array.isArray(data))return [];
      const seen=new Set();return data.filter(p=>Number.isSafeInteger(p.id)&&p.id>0&&p.id<=2147483647&&
        ['free','maintenance','parts','drive'].includes(p.category)&&typeof p.title==='string'&&p.title.length<=150&&
        Number.isFinite(p.viewedAt)&&!seen.has(p.id)&&seen.add(p.id)).slice(0,5);
    }catch{return [];}
  }
  function remember(post){
    try{localStorage.setItem(storageKey,JSON.stringify([{id:post.id,category:post.category,title:post.title,viewedAt:Date.now()},...recent().filter(p=>p.id!==post.id)].slice(0,5)));}catch{}
  }
  function forget(id){try{localStorage.setItem(storageKey,JSON.stringify(recent().filter(p=>p.id!==id)));}catch{}}
  function renderRecent(){
    const root=$('#community-recent-list');if(!root)return;
    const posts=recent();root.replaceChildren(...posts.map(p=>link(p.title,getPostUrl(p),'community-side-post')));
    if(!posts.length)root.append(el('p','아직 읽은 글이 없습니다.','context-muted'));
  }
  function sync(){
    if(!isList())return;
    const [title,description]=headings[state.category]||headings[''];
    $('#community-title').textContent=title;$('#community-description').textContent=description;
    document.querySelectorAll('[data-category]').forEach(b=>{const active=b.dataset.category===state.category;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    document.querySelectorAll('[data-community-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.communityScope===state.scope)));
    const url=new URL(location.href);
    for(const [key,value] of Object.entries({category:state.category,q:state.query,vehicle:state.vehicle,scope:state.scope,sort:state.sort==='latest'?'':state.sort}))value?url.searchParams.set(key,value):url.searchParams.delete(key);
    history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  function row(post){
    const article=el('article','','community-feed-row');
    const title=link('',getPostUrl(post),'community-feed-title');
    if(post.imageIds?.length)title.append(photo(post.imageIds[0],`${post.title} 첨부 사진`));
    const text=el('div');text.append(el('strong',post.title),el('span',headings[post.category]?.[0]||post.category,'post-category'));title.append(text);
    const author=memberLink(post.authorId,post.username);author.classList.add('community-feed-author');
    const time=el('time',new Date(post.createdAt).toLocaleDateString('ko-KR'),'community-feed-date');time.dateTime=post.createdAt;
    article.append(title,author,time);
    for(const [label,value] of [['조회',post.views],['추천',post.likeCount],['댓글',post.commentCount]]){
      const stat=el('span',String(value),'community-feed-stat');stat.setAttribute('aria-label',`${label} ${value}`);article.append(stat);
    }
    return article;
  }
  async function garage(){
    if(!isList())return;
    refreshMiniGarage ||= createMyGarageCard({root:$('#community-my-garage'),api,getUser:()=>state.user,el,link,photo,button});
    return refreshMiniGarage();
  }
  async function popular(){
    const root=$('#community-popular');
    try{const posts=await api('/api/board/posts?sort=popular&limit=5');root.replaceChildren();
      posts.forEach((p,i)=>{const a=link('',getPostUrl(p),'community-popular-row');a.append(el('span',String(i+1),'community-rank'),el('strong',p.title),el('span',`♡ ${p.likeCount}`,'context-muted'));root.append(a);});
      if(!posts.length)root.append(el('p','아직 등록된 글이 없습니다.','context-muted'));
    }catch{root.replaceChildren(el('p','인기글을 불러오지 못했어요.','context-muted'),button('다시 확인',popular,'text-link'));}
  }
  function setup(){
    if(!$('#community-left'))return;
    const active=isList();$('#community-left').hidden=!active;$('#community-right').hidden=!active;
    $('#main').classList.toggle('community-list-layout',active);
    if(!active){void popular();return;}
    const params=new URLSearchParams(location.search);
    state.query=(params.get('q')||'').slice(0,100);$('#search-input').value=state.query;
    if(['latest','popular'].includes(params.get('sort'))){state.sort=params.get('sort');$('#post-sort').value=state.sort;}
    if(['mine','commented','bookmarks'].includes(params.get('scope')))state.scope=params.get('scope');
    document.querySelectorAll('[data-community-scope]').forEach(b=>on(b,'click',()=>showScope(b.dataset.communityScope)));
    renderRecent();void popular();
    on(window,'storage',e=>{if(e.key===storageKey)renderRecent();});
    on(window,'pageshow',()=>renderRecent());
  }
  return {setup,sync,row,garage,remember,forget,isList,popular};
})();
