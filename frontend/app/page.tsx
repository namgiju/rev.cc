'use client';

import {ChangeEvent, FormEvent, useState} from 'react';

type Comment = {id: string; author: string; body: string; replies: Comment[]};
type Board = '현대 N' | 'BMW' | '벤츠';
type Post = {id: string; title: string; body: string; owner: string; car: string; board: Board; comments: Comment[]};

const boards: Board[] = ['현대 N', 'BMW', '벤츠'];

const initialPosts: Post[] = [
	{id: 'post-1', title: 'PS5 교체하고 와인딩 다녀온 후기', body: '순정 타이어에서 바꾸고 첫 주행했습니다.', owner: 'NDRIVER', car: 'Avante N 2024', board: '현대 N', comments: []},
	{id: 'post-2', title: 'F30 320i 냉각수 누수 수리비 공유', body: '교체 부품과 공임, 증상을 정리했습니다.', owner: 'F30LAB', car: 'BMW 320i 2018', board: 'BMW', comments: []},
	{id: 'post-3', title: 'W206 출고 후 첫 장거리 주행기', body: '고속도로 주행감과 연비를 정리해 봤습니다.', owner: 'STARROAD', car: 'Mercedes-Benz C200 2024', board: '벤츠', comments: []}
];

type View = 'community' | 'garage' | 'parts' | 'drive' | 'login' | 'signup';

const menu: {label: string; view: View}[] = [
	{label: '커뮤니티', view: 'community'},
	{label: '차고', view: 'garage'},
	{label: '부품장터', view: 'parts'},
	{label: '드라이브', view: 'drive'}
];

export default function Home() {
	const [view, setView] = useState<View>('community');
	const [loggedIn, setLoggedIn] = useState(false);
	const [isAdmin, setIsAdmin] = useState(false);
	const [posts, setPosts] = useState<Post[]>(initialPosts);
	const [garagePhoto, setGaragePhoto] = useState<string | null>(null);
	const [nicePhoto, setNicePhoto] = useState(false);

	const openView = (nextView: View) => {
		if (!loggedIn && menu.some(item => item.view === nextView)) {
			setView('login');
			return;
		}
		setView(nextView);
	};

	const handleAuth = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		setIsAdmin(formData.get('username') === 'admin');
		setLoggedIn(true);
		setView('community');
	};

	const handleCreatePost = (title: string, body: string, board: Board) => {
		setPosts(current => [{id: `post-${Date.now()}`, title, body, owner: isAdmin ? 'ADMIN' : 'ME', car: board === '현대 N' ? 'Avante N 2024' : board, board, comments: []}, ...current]);
	};

	const handleAddComment = (postId: string, body: string, parentId?: string) => {
		const author = isAdmin ? 'ADMIN' : 'ME';
		const comment: Comment = {id: `comment-${Date.now()}`, author, body, replies: []};
		setPosts(current => current.map(post => post.id === postId ? {...post, comments: parentId ? addReply(post.comments, parentId, comment) : [...post.comments, comment]} : post));
	};

	const handleDeletePost = (postId: string) => setPosts(current => current.filter(post => post.id !== postId));
	const handleDeleteComment = (postId: string, commentId: string) => setPosts(current => current.map(post => post.id === postId ? {...post, comments: removeComment(post.comments, commentId)} : post));

	return <main>
		<header>
			<button className="brand" onClick={() => setView('community')}>REV.CC</button>
			<nav>{menu.map(item => <button key={item.view} onClick={() => openView(item.view)}>{item.label}</button>)}</nav>
			<div className="auth-nav">
				{loggedIn ? <><span className="user-badge">{isAdmin ? '관리자' : '회원'}</span><button onClick={() => {setLoggedIn(false); setIsAdmin(false); setView('community');}}>로그아웃</button></> : <><button onClick={() => setView('login')}>로그인</button><button className="signup-link" onClick={() => setView('signup')}>회원가입</button></>}
			</div>
		</header>
		{view === 'login' || view === 'signup' ? <AuthView mode={view} onSubmit={handleAuth} onChangeMode={setView} /> : <>
			<section className="hero"><div><small>자동차 오너 커뮤니티</small><h1>차를 좋아하는 사람들의<br/>진짜 공간.</h1><p>내 차를 프로필로 만들고, 같은 차를 타는 사람들과 정보를 나누고 부품을 거래하세요.</p></div>{loggedIn ? <GarageCard photo={garagePhoto} nicePhoto={nicePhoto} onPhotoChange={setGaragePhoto} onToggleNicePhoto={() => setNicePhoto(current => !current)} /> : <GuestGarageCard onSignup={() => setView('signup')} />}</section>
			{view === 'community' && <CommunityView posts={posts} loggedIn={loggedIn} isAdmin={isAdmin} onCreatePost={handleCreatePost} onAddComment={handleAddComment} onDeletePost={handleDeletePost} onDeleteComment={handleDeleteComment} />}
			{view === 'garage' && <GarageView photo={garagePhoto} nicePhoto={nicePhoto} onPhotoChange={setGaragePhoto} onToggleNicePhoto={() => setNicePhoto(current => !current)} />}
			{view === 'parts' && <ContentView title="부품장터" description="내 차에 맞는 부품을 찾아보세요." body="Avante N용 휠, 브레이크 패드, 순정 스포일러를 준비 중입니다." />}
			{view === 'drive' && <ContentView title="드라이브" description="자동차를 좋아하는 오너들과 함께 달려보세요." body="이번 주 드라이브 모임을 준비 중입니다." />}
		</>}
	</main>;
}

function CommunityView({posts, loggedIn, isAdmin, onCreatePost, onAddComment, onDeletePost, onDeleteComment}: {posts: Post[]; loggedIn: boolean; isAdmin: boolean; onCreatePost: (title: string, body: string, board: Board) => void; onAddComment: (postId: string, body: string, parentId?: string) => void; onDeletePost: (postId: string) => void; onDeleteComment: (postId: string, commentId: string) => void}) {
	const [showComposer, setShowComposer] = useState(false);
	const [title, setTitle] = useState('');
	const [body, setBody] = useState('');
	const [selectedBoard, setSelectedBoard] = useState<Board | '전체'>('전체');
	const [hoveredBoard, setHoveredBoard] = useState<Board | '전체' | null>(null);

	const submitPost = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!title.trim() || !body.trim()) return;
		onCreatePost(title.trim(), body.trim(), selectedBoard === '전체' ? '현대 N' : selectedBoard);
		setTitle('');
		setBody('');
		setShowComposer(false);
	};

	const visiblePosts = selectedBoard === '전체' ? posts : posts.filter(post => post.board === selectedBoard);
	const boardTitle = selectedBoard === '전체' ? '전체 게시판' : `${selectedBoard} 게시판`;
	const boardDescription = selectedBoard === '현대 N' ? 'N 브랜드의 고성능 모델과 주행 경험을 나누는 공간입니다.' : selectedBoard === 'BMW' ? 'BMW 모델별 정비, 튜닝, 주행 정보를 나누는 공간입니다.' : selectedBoard === '벤츠' ? 'Mercedes-Benz 오너들의 차량 관리와 라이프스타일 이야기입니다.' : '차를 좋아하는 모든 오너가 함께 정보를 나누는 공간입니다.';
	return <section id="community"><div className="community-board-layout" style={{display: 'grid', gridTemplateColumns: '190px minmax(0, 1fr)', gap: 22, alignItems: 'start'}}><aside className="board-sidebar" style={{background: '#14161b', border: '1px solid #262a33', borderRadius: 16, padding: 14}}><strong style={{display: 'block', marginBottom: 12}}>차종별 게시판</strong><button style={sideBoardStyle(selectedBoard === '전체')} onClick={() => setSelectedBoard('전체')}>전체 게시판</button>{boards.map(board => <button key={board} style={sideBoardStyle(selectedBoard === board)} onClick={() => setSelectedBoard(board)}>{board} 게시판</button>)}</aside><div className="board-main"><div className="section-heading"><div><h2>{boardTitle}</h2><p>{boardDescription}</p></div>{loggedIn && <button className="write-button" onClick={() => setShowComposer(current => !current)}>글쓰기</button>}</div><div className="vehicle-info-strip" style={{display: 'grid', gridTemplateColumns: '1.4fr .6fr 1fr', gap: 12, margin: '20px 0', padding: 18, background: '#101217', border: '1px solid #303641', borderRadius: 14}}><div><small>선택한 차종</small><strong style={{display: 'block', fontSize: 22, marginTop: 6}}>{selectedBoard === '전체' ? 'REV.CC 전체 오너' : selectedBoard}</strong></div><div><small>게시글</small><b style={{display: 'block', marginTop: 8}}>{visiblePosts.length}개</b></div><div><small>차량 문화</small><b style={{display: 'block', marginTop: 8}}>정보 · 정비 · 튜닝</b></div></div>{showComposer && <form className="post-composer" onSubmit={submitPost}><select value={selectedBoard === '전체' ? '현대 N' : selectedBoard} onChange={event => setSelectedBoard(event.target.value as Board)}><option value="현대 N">현대 N 게시판</option><option value="BMW">BMW 게시판</option><option value="벤츠">벤츠 게시판</option></select><input value={title} onChange={event => setTitle(event.target.value)} placeholder="게시글 제목" required /><textarea value={body} onChange={event => setBody(event.target.value)} placeholder="차량 경험과 이야기를 적어주세요" rows={4} required /><button className="submit-button" type="submit">게시글 등록</button></form>}{visiblePosts.length ? visiblePosts.map(post => <PostItem key={post.id} post={post} isAdmin={isAdmin} onAddComment={onAddComment} onDeletePost={onDeletePost} onDeleteComment={onDeleteComment} />) : <div className="empty-board" style={{padding: '48px 20px', textAlign: 'center', color: '#9da4b2', background: '#14161b', border: '1px solid #262a33', borderRadius: 20}}>아직 이 게시판에 등록된 글이 없습니다.</div>}</div></div></section>;
}

function sideBoardStyle(selected: boolean): React.CSSProperties {
	return {display: 'block', width: '100%', border: 0, borderRadius: 9, background: selected ? '#fff' : 'transparent', color: selected ? '#0b0c0f' : '#aab2c0', textAlign: 'left', padding: '11px 12px', marginBottom: 5, cursor: 'pointer', fontWeight: 700};
}

function boardTabStyle(selected: boolean): React.CSSProperties {
	return {border: 0, borderBottom: selected ? '2px solid #fff' : '2px solid transparent', background: 'none', color: selected ? '#fff' : '#929bab', padding: '10px 15px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap'};
}

function PostItem({post, isAdmin, onAddComment, onDeletePost, onDeleteComment}: {post: Post; isAdmin: boolean; onAddComment: (postId: string, body: string, parentId?: string) => void; onDeletePost: (postId: string) => void; onDeleteComment: (postId: string, commentId: string) => void}) {
	const [comment, setComment] = useState('');
	const [expanded, setExpanded] = useState(false);
	const submitComment = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!comment.trim()) return;
		onAddComment(post.id, comment.trim());
		setComment('');
	};

	if (!expanded) return <button className="post-title-row" style={{display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto auto', alignItems: 'center', gap: 12, width: '100%', border: 0, borderBottom: '1px solid #282c34', background: 'transparent', color: '#f4f6fa', padding: '16px 8px', textAlign: 'left', cursor: 'pointer'}} onClick={() => setExpanded(true)}><span className="board-label" style={{margin: 0}}>{post.board}</span><strong>{post.title}</strong><small style={{color: '#9da4b2'}}>{post.owner} · 댓글 {countComments(post.comments)}개</small><span style={{color: '#9da4b2', fontSize: 20}}>›</span></button>;

	return <article className="post-card"><div className="post-heading"><div><span className="board-label" style={{display: 'inline-block', background: '#2b313b', color: '#dce2eb', borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 700, marginBottom: 9}}>{post.board}</span><h3>{post.title}</h3><p>{post.body}</p></div>{isAdmin && <button className="delete-button" onClick={() => onDeletePost(post.id)}>게시글 삭제</button>}</div><div className="signature"><b>{post.owner}</b><span>{post.car}</span></div><div className="comments"><strong>댓글 {countComments(post.comments)}개</strong>{post.comments.map(item => <CommentItem key={item.id} comment={item} postId={post.id} isAdmin={isAdmin} onAddComment={onAddComment} onDeleteComment={onDeleteComment} />)}<form className="comment-form" onSubmit={submitComment}><input value={comment} onChange={event => setComment(event.target.value)} placeholder="댓글을 입력하세요" /><button type="submit">댓글</button></form></div></article>;
}

function CommentItem({comment, postId, isAdmin, onAddComment, onDeleteComment}: {comment: Comment; postId: string; isAdmin: boolean; onAddComment: (postId: string, body: string, parentId?: string) => void; onDeleteComment: (postId: string, commentId: string) => void}) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [reply, setReply] = useState('');
	const submitReply = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!reply.trim()) return;
		onAddComment(postId, reply.trim(), comment.id);
		setReply('');
		setReplyOpen(false);
	};

	return <div className="comment-item"><div className="comment-line"><div><b>{comment.author}</b><p>{comment.body}</p></div>{isAdmin && <button className="delete-button" onClick={() => onDeleteComment(postId, comment.id)}>삭제</button>}</div><button className="reply-button" onClick={() => setReplyOpen(current => !current)}>대댓글 달기</button>{replyOpen && <form className="comment-form reply-form" onSubmit={submitReply}><input value={reply} onChange={event => setReply(event.target.value)} placeholder="대댓글을 입력하세요" /><button type="submit">등록</button></form>}{comment.replies.map(item => <div className="reply-item" key={item.id}><div className="comment-line"><div><b>{item.author}</b><p>{item.body}</p></div>{isAdmin && <button className="delete-button" onClick={() => onDeleteComment(postId, item.id)}>삭제</button>}</div></div>)}</div>;
}

function addReply(comments: Comment[], parentId: string, reply: Comment): Comment[] {
	return comments.map(comment => comment.id === parentId ? {...comment, replies: [...comment.replies, reply]} : {...comment, replies: addReply(comment.replies, parentId, reply)});
}

function removeComment(comments: Comment[], commentId: string): Comment[] {
	return comments.filter(comment => comment.id !== commentId).map(comment => ({...comment, replies: removeComment(comment.replies, commentId)}));
}

function countComments(comments: Comment[]): number {
	return comments.reduce((count, comment) => count + 1 + countComments(comment.replies), 0);
}

function ContentView({title, description, body}: {title: string; description: string; body: string}) {
	return <section className="content-view"><h2>{title}</h2><p>{description}</p><div className="content-placeholder">{body}</div></section>;
}

function GarageCard({photo, nicePhoto, onPhotoChange, onToggleNicePhoto}: {photo: string | null; nicePhoto: boolean; onPhotoChange: (photo: string) => void; onToggleNicePhoto: () => void}) {
	return <div className="garage"><div className="garage-photo-frame">{photo ? <img className={nicePhoto ? 'nice-photo' : ''} src={photo} alt="내 차 사진" /> : <div className="photo-empty"><span>🚘</span><b>차고에 차량 사진이 없어요</b><small>내 차 사진을 추가해 볼까요?</small></div>}</div><div className="garage-details"><div><h2>내 차고</h2><strong>Hyundai Avante N</strong><span>2024 · 280 PS · 인증된 오너</span></div><PhotoUpload onPhotoChange={onPhotoChange} /></div>{photo && <button className="photo-effect-button" onClick={onToggleNicePhoto}>{nicePhoto ? '원본 사진 보기' : '느좋 사진으로 보기'}</button>}</div>;
}

function GuestGarageCard({onSignup}: {onSignup: () => void}) {
	return <div className="garage guest-garage"><div className="member-signature-photo"><img src="/image.png" alt="회원 차량 Toyota GR Supra" /></div><div className="member-signature-details"><span className="signature-label">회원 차량 인장</span><strong>Toyota GR Supra</strong><b>SUPRA DRIVER</b><small>2024 · 인증된 오너</small></div><div className="guest-garage-copy"><h2>내 차고를 만들어보세요</h2><p>내 차 사진과 차량 정보를 담은 나만의 차량 인장을 만들어보세요.</p><button className="signup-garage-button" onClick={onSignup}>내 차고 만들러 가기</button></div></div>;
}

function GarageView({photo, nicePhoto, onPhotoChange, onToggleNicePhoto}: {photo: string | null; nicePhoto: boolean; onPhotoChange: (photo: string) => void; onToggleNicePhoto: () => void}) {
	return <section className="content-view garage-view"><h2>내 차고</h2><p>차량과 튜닝, 정비 기록을 한곳에서 관리하세요.</p><GarageCard photo={photo} nicePhoto={nicePhoto} onPhotoChange={onPhotoChange} onToggleNicePhoto={onToggleNicePhoto} /></section>;
}

function PhotoUpload({onPhotoChange}: {onPhotoChange: (photo: string) => void}) {
	const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (file) onPhotoChange(URL.createObjectURL(file));
	};

	return <label className="upload-button">사진 추가<input type="file" accept="image/*" onChange={handlePhotoChange} /></label>;
}

function AuthView({mode, onSubmit, onChangeMode}: {mode: 'login' | 'signup'; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onChangeMode: (view: View) => void}) {
	const isLogin = mode === 'login';
	return <section className="auth-view"><div className="auth-card"><small>REV.CC 회원</small><h1>{isLogin ? '로그인' : '회원가입'}</h1><p>{isLogin ? '아이디로 로그인해 서비스를 이용하세요.' : '자동차 오너 커뮤니티의 회원이 되어 보세요.'}</p><form onSubmit={onSubmit}>{!isLogin && <label>닉네임<input type="text" required placeholder="닉네임을 입력하세요" /></label>}<label>아이디<input type="text" required autoComplete="username" placeholder="아이디를 입력하세요" /></label><label>비밀번호<input type="password" required autoComplete={isLogin ? 'current-password' : 'new-password'} placeholder="비밀번호를 입력하세요" /></label>{!isLogin && <label>비밀번호 확인<input type="password" required autoComplete="new-password" placeholder="비밀번호를 다시 입력하세요" /></label>}{!isLogin && <label className="terms"><input type="checkbox" required /> 이용약관과 개인정보 처리방침에 동의합니다.</label>}<button className="submit-button" type="submit">{isLogin ? '로그인' : '가입하기'}</button></form><button className="text-button" onClick={() => onChangeMode(isLogin ? 'signup' : 'login')}>{isLogin ? '처음 오셨나요? 회원가입' : '이미 계정이 있나요? 로그인'}</button></div></section>;
}
