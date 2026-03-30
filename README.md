# Naver Blog Backup (cha_j212)

이 저장소는 네이버 블로그 `cha_j212`의 공개 글을 백업하고 GitHub에서 관리하기 위한 두 가지 수집 방식을 함께 포함합니다.

- Python 기반 전체 백업 스크립트: `backup_naver_blog.py`
- Node.js 기반 카테고리 크롤러: `scripts/crawl-naver-board.mjs`

기본 대상 카테고리는 아래 두 개입니다.

- `https://blog.naver.com/PostList.naver?blogId=cha_j212&from=postList&categoryNo=16`
- `https://blog.naver.com/PostList.naver?blogId=cha_j212&from=postList&categoryNo=17`

## 포함 기능

- `PostTitleListAsync.naver` 기반 글 목록 수집
- `PostView.naver` 및 모바일 뷰 기반 본문 추출
- 글별 Markdown 생성
- JSON 인덱스 생성
- GitHub Actions를 통한 자동 갱신

## 1. Python 전체 백업

기존 Python 스크립트는 공개 글 전체를 백업하는 용도입니다.

### 설치

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 실행

기본 실행:

```bash
python backup_naver_blog.py
```

출력 폴더 지정:

```bash
python backup_naver_blog.py --output export
```

이미지 다운로드 없이:

```bash
python backup_naver_blog.py --skip-images
```

일부만 테스트:

```bash
python backup_naver_blog.py --limit 5
```

### 결과물

```bash
export/
  index.json
  posts/
  images/
```

## 2. Node 카테고리 크롤러

Node 스크립트는 특정 카테고리 글을 빠르게 수집해 `data/` 와 `posts/` 에 저장하는 용도입니다. 기본값은 카테고리 `16,17` 을 함께 수집합니다.

### 설치

```bash
npm install
```

### 실행

```bash
npm run crawl
```

환경변수로 다른 블로그나 여러 카테고리에도 재사용할 수 있습니다.

```bash
NAVER_BLOG_ID=cha_j212 NAVER_CATEGORY_NOS=16,17 npm run crawl
```

일부만 시험하려면:

```bash
MAX_POSTS=3 npm run crawl
```

### 결과물

```bash
data/posts.json
data/full-posts.json
posts/*.md
```

## GitHub Actions

`.github/workflows/crawl-naver-board.yml` 이 포함되어 있으며 아래 작업을 수행합니다.

- 수동 실행 가능
- 매일 `09:00 KST` 자동 실행
- `npm ci`
- `npm run crawl`
- 변경 사항이 있으면 자동 커밋/푸시

## GitHub 업로드

```bash
git add .
git commit -m "Update blog backup"
git push
```

## 주의

- 네이버 HTML 구조가 바뀌면 selector 보정이 필요할 수 있습니다.
- 비공개 글, 서로이웃 글, 로그인 필요한 글은 기본 스크립트로 백업되지 않습니다.
- 과도한 요청은 차단될 수 있으니 주기와 요청량을 조절하는 편이 안전합니다.
- 본문 전체를 재배포하는 경우에는 저작권과 서비스 정책을 먼저 확인하세요.
