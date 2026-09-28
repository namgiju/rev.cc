// Shared by the personal garage and the existing member dialog, never board_comments.
async function renderGuestbook(root, ownerId, {current = () => root.isConnected, viewer = () => state.user} = {}) {
  let cursor=null, request=0;
  root.replaceChildren(el('h2','방명록'));
  const heading=root.firstChild, list=el('div','','guestbook-list'), form=el('form','','comment-form');
  const input=document.createElement('textarea'); input.maxLength=1000; input.required=true; input.rows=3;
  input.placeholder='서로를 존중하는 따뜻한 메시지를 남겨주세요.'; input.setAttribute('aria-label','방명록 내용');
  const submit=el('button','방명록 등록','primary');submit.type='submit';form.append(input,submit);
  const more=button('더 보기',()=>load(true),'secondary');more.hidden=true;
  root.append(form,list,more);
  if (!viewer()) form.replaceChildren(el('p','방명록을 남기려면 로그인해주세요.','context-muted'));
  async function load(append=false){
    const ticket=++request;
    try{
      const data=await api(`/api/board/members/${ownerId}/guestbook${append&&cursor?`?before=${cursor}`:''}`);
      if(!current()||ticket!==request)return;
      heading.textContent=`방명록 ${data.total}`;if(!append)list.replaceChildren();
      if(!data.total)list.append(el('p','아직 남겨진 메시지가 없습니다.','empty'));
      for(const entry of data.items){
        const row=el('article','','comment');row.dataset.entryId=entry.id;
        const meta=el('div','','comment-meta');meta.append(memberLink(entry.authorId,entry.username),el('span',dateText(entry.createdAt)));
        if(viewer() && [entry.authorId,ownerId].includes(viewer().id))meta.append(button('삭제',async()=>{
          if(!await confirmDelete('이 방명록 메시지를 삭제할까요?'))return;
          await api(`/api/board/members/${ownerId}/guestbook/${entry.id}`,{},'DELETE');await load();
        },'danger-text'));
        row.append(meta,el('p',entry.content));list.append(row);
      }
      cursor=data.nextCursor;more.hidden=!cursor;
    }catch(error){if(current()){list.replaceChildren(el('p','방명록을 불러오지 못했어요.','empty'),button('다시 시도',()=>load()));}}
  }
  on(form,'submit',async event=>{
    event.preventDefault();if(!requireLogin())return;submit.disabled=true;
    try{await api(`/api/board/members/${ownerId}/guestbook`,{content:input.value});if(current()){input.value='';await load();}}
    finally{submit.disabled=false;}
  });
  await load();
}
