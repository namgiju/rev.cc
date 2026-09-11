const posts=[
 {title:'PS5 교체하고 와인딩 다녀온 후기',body:'순정 타이어에서 바꾸고 첫 주행했습니다.',owner:'NDRIVER',car:'Avante N 2024'},
 {title:'F30 320i 냉각수 누수 수리비 공유',body:'교체 부품과 공임, 증상을 정리했습니다.',owner:'F30LAB',car:'BMW 320i 2018'}
];
export default function Home(){return <main><header><b>REV.CC</b><nav>Community · Garage · Parts · Drive</nav></header><section className="hero"><div><small>CAR OWNER COMMUNITY</small><h1>차를 좋아하는 사람들의<br/>진짜 공간.</h1><p>내 차를 프로필로 만들고, 같은 차를 타는 사람들과 정보를 나누고 부품을 거래하세요.</p></div><div className="garage"><h2>My Garage</h2><strong>Hyundai Avante N</strong><span>2024 · 280 PS · Verified Owner</span></div></section><section><h2>커뮤니티</h2>{posts.map(p=><article key={p.title}><h3>{p.title}</h3><p>{p.body}</p><div className="signature"><b>{p.owner}</b><span>{p.car}</span></div></article>)}</section></main>}
