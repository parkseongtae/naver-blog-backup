# Naver Blog Backup (cha_j212)

이 레포는 네이버 블로그 `cha_j212`의 공개 글을 로컬로 백업한 뒤 GitHub에 올릴 수 있도록 만든 완성형 백업 스크립트를 포함합니다.

## 포함 기능

- `PostTitleListAsync.naver` 기반 전체 글 목록 수집
- RSS 기반 보조 수집
- `PostView.naver` 직접 접근 및 모바일 뷰 fallback
- 제목 / 날짜 / 본문 / 태그 / 대표 URL 추출
- 본문 이미지 로컬 저장 및 Markdown 경로 치환
- 게시글별 Markdown 파일 생성
- `index.json` 매니페스트 생성
- 중복 글 방지 및 파일명 정리

네이버 블로그는 iframe 구조를 사용하므로 외부 프레임이 아니라 내부 글 URL인 `PostView.naver`를 직접 호출하는 방식이 핵심입니다. 또한 공개 글 목록은 `PostTitleListAsync.naver` 응답에서 페이지 단위로 수집할 수 있습니다. citeturn230901search1turn300100search5

## 설치

```bash
git clone https://github.com/parkseongtae/naver-blog-backup.git
cd naver-blog-backup
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 실행

기본 실행:

```bash
python backup_naver_blog.py
```

출력 폴더 지정:

```bash
python backup_naver_blog.py --output export
```

이미지 다운로드 없이 본문만:

```bash
python backup_naver_blog.py --skip-images
```

특정 개수만 테스트:

```bash
python backup_naver_blog.py --limit 5
```

## 결과물

```bash
export/
  index.json
  posts/
    2026-03-30__글제목__223123456789.md
  images/
    223123456789/
      001.jpg
      002.png
```

## GitHub 업로드

```bash
git add export
git commit -m "Add blog backup export"
git push
```

## 주의

- 네이버 HTML 구조가 바뀌면 selector 보정이 필요할 수 있습니다.
- 비공개 글, 서로이웃 글, 로그인 필요한 글은 기본 스크립트로 백업되지 않습니다.
- 과도한 요청은 차단될 수 있어 요청 간 짧은 대기 시간을 넣었습니다.
- 네이버 검색 Open API는 블로그 검색 결과 API이며 특정 블로그의 전체 본문 export API는 아닙니다. citeturn230901search2
