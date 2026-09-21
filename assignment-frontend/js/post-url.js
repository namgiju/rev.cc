// 게시글 링크를 만드는 유일한 지점. index.html/community/home 등 여러 페이지에서
// 이 파일 하나를 공유해서 쓴다(app.js와 home.js는 서로 다른 문서라 함수를 공유할 수 없다).
const POST_CATEGORIES = ["free", "maintenance", "parts", "drive"];
function getPostUrl(post) {
  const category = POST_CATEGORIES.includes(post.category) ? post.category : "free";
  return `/community/${category}/${post.id}`;
}
