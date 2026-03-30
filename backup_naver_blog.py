import os
import re
import json
import time
import argparse
import requests
import feedparser
from bs4 import BeautifulSoup
from markdownify import markdownify as md

BLOG_ID = "cha_j212"
BASE_VIEW = "https://blog.naver.com/PostView.naver"
MOBILE_VIEW = "https://m.blog.naver.com/PostView.naver"
LIST_API = "https://blog.naver.com/PostTitleListAsync.naver"
RSS_URL = f"https://rss.blog.naver.com/{BLOG_ID}.xml"

HEADERS = {"User-Agent": "Mozilla/5.0"}


def sanitize(s):
    return re.sub(r"[\\/:*?\"<>|]", "_", s)


def get_all_post_ids():
    ids = set()

    # 1. Async list pagination
    page = 1
    while True:
        params = {
            "blogId": BLOG_ID,
            "currentPage": page,
            "countPerPage": 30,
            "categoryNo": 0,
            "parentCategoryNo": 0,
        }
        r = requests.get(LIST_API, params=params, headers=HEADERS)
        text = r.text

        found = re.findall(r'"logNo":"(\\d+)"', text)
        if not found:
            break

        ids.update(found)
        print(f"page {page} -> {len(found)} posts")
        page += 1
        time.sleep(0.5)

    # 2. RSS fallback
    feed = feedparser.parse(RSS_URL)
    for e in feed.entries:
        m = re.search(r"logNo=(\\d+)", e.link)
        if m:
            ids.add(m.group(1))

    return list(ids)


def fetch_post(log_no):
    for url in [BASE_VIEW, MOBILE_VIEW]:
        try:
            r = requests.get(url, params={"blogId": BLOG_ID, "logNo": log_no}, headers=HEADERS)
            soup = BeautifulSoup(r.text, "lxml")

            title = soup.select_one(".se-title-text, .pcol1, h3")
            content = soup.select_one(".se-main-container, #postViewArea")

            if not content:
                continue

            title = title.get_text(strip=True) if title else f"post_{log_no}"

            # remove scripts
            for tag in content(["script", "style"]):
                tag.decompose()

            # images
            img_dir = os.path.join("export/images", log_no)
            os.makedirs(img_dir, exist_ok=True)

            for i, img in enumerate(content.select("img")):
                src = img.get("data-lazy-src") or img.get("src")
                if not src:
                    continue
                try:
                    img_data = requests.get(src, headers=HEADERS).content
                    ext = ".jpg"
                    if "png" in src:
                        ext = ".png"
                    fname = f"{i:03d}{ext}"
                    with open(os.path.join(img_dir, fname), "wb") as f:
                        f.write(img_data)
                    img["src"] = f"../images/{log_no}/{fname}"
                except:
                    continue

            html = str(content)
            markdown = md(html)

            return title, markdown
        except:
            continue
    return None, None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="export")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--skip-images", action="store_true")
    args = parser.parse_args()

    os.makedirs("export/posts", exist_ok=True)

    ids = get_all_post_ids()
    if args.limit:
        ids = ids[: args.limit]

    results = []

    for log_no in ids:
        title, body = fetch_post(log_no)
        if not body:
            continue

        fname = sanitize(title) + f"_{log_no}.md"
        path = os.path.join("export/posts", fname)

        with open(path, "w", encoding="utf-8") as f:
            f.write(f"# {title}\n\n{body}")

        results.append({"id": log_no, "title": title, "file": fname})
        print("saved", title)
        time.sleep(1)

    with open("export/index.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
