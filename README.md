# 네이버 블로그 게시판 크롤링 + GitHub 연동

이 프로젝트는 네이버 블로그 특정 카테고리의 글 목록을 수집하고, 각 글 본문을 Markdown/JSON으로 저장한 뒤 GitHub 저장소에서 관리할 수 있게 만든 예제입니다.

현재 기본 대상은 아래 URL입니다.

- 목록 URL: `https://blog.naver.com/PostList.naver?blogId=cha_j212&from=postList&categoryNo=16`
- `blogId`: `cha_j212`
- `categoryNo`: `16`

## 동작 방식

1. 목록은 `PostTitleListAsync.naver` JSON 엔드포인트에서 읽습니다.
2. 각 글 본문은 `m.blog.naver.com/PostView.naver` 모바일 HTML에서 파싱합니다.
3. 결과는 아래처럼 저장됩니다.

- `data/posts.json`: 가벼운 인덱스
- `data/full-posts.json`: 본문 포함 전체 데이터
- `posts/{logNo}.md`: 글별 Markdown 파일

## 설치

```bash
npm install
```

## 실행

```bash
npm run crawl
```

## 옵션

기본값은 현재 대상 블로그와 카테고리로 설정되어 있습니다. 다른 게시판에도 재사용하려면 환경변수를 넘기면 됩니다.

```bash
NAVER_BLOG_ID=cha_j212 NAVER_CATEGORY_NO=16 npm run crawl
```

일부만 시험하고 싶으면:

```bash
MAX_POSTS=3 npm run crawl
```

## GitHub에 연결하는 방법

### 1. 로컬 폴더를 Git 저장소로 초기화

```bash
git init
git add .
git commit -m "Add Naver blog crawler"
```

### 2. GitHub에서 새 저장소 생성

예시 저장소 이름:

- `naver-blog-crawler`

### 3. 원격 저장소 연결 후 push

`YOUR_ID`와 저장소 이름은 본인 계정 기준으로 바꿔주세요.

```bash
git branch -M main
git remote add origin https://github.com/YOUR_ID/naver-blog-crawler.git
git push -u origin main
```

### 4. GitHub Actions로 자동 갱신

이미 `.github/workflows/crawl-naver-board.yml` 파일이 들어 있습니다.

- 수동 실행: GitHub 저장소의 `Actions` 탭에서 실행
- 자동 실행: 매일 `09:00 KST`에 실행되도록 `cron: "0 0 * * *"`로 설정

이 워크플로우는:

1. 저장소 체크아웃
2. Node 설치
3. `npm ci`
4. `npm run crawl`
5. 변경이 있으면 자동 커밋/푸시

## 주의할 점

- 네이버 서비스 정책, robots, 저작권을 먼저 확인하세요.
- 본문 전체를 재배포하는 용도라면 특히 권한과 저작권 이슈를 점검하는 편이 안전합니다.
- 페이지 구조가 바뀌면 선택자(`.se-main-container`, `.blog_date` 등)를 수정해야 할 수 있습니다.

## 확인 포인트

크롤링 후 아래 파일이 생기면 정상입니다.

```bash
data/posts.json
data/full-posts.json
posts/*.md
```
