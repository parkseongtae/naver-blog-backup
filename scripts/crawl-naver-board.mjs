import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";

import axios from "axios";
import { load } from "cheerio";
import he from "he";

const { decode: decodeHtml } = he;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const postsDir = path.join(rootDir, "posts");

const BLOG_ID = process.env.NAVER_BLOG_ID ?? "cha_j212";
const CATEGORY_INPUT =
  process.env.NAVER_CATEGORY_NOS ?? process.env.NAVER_CATEGORY_NO ?? "16,17";
const CATEGORY_NOS = [...new Set(CATEGORY_INPUT.split(",").map((value) => value.trim()))].filter(
  Boolean
);
const COUNT_PER_PAGE = Number(process.env.COUNT_PER_PAGE ?? "30");
const MAX_POSTS = Number(process.env.MAX_POSTS ?? "0");

const client = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    Accept: "text/html,application/json"
  },
  timeout: 20000
});

function decodeTitle(value = "") {
  return decodeHtml(decodeURIComponent(value.replace(/\+/g, " ")))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return decodeHtml(value)
    .replace(/\u200b/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownEscape(value = "") {
  return value.replace(/[\\`*_{}\[\]()#+\-.!]/g, "\\$&");
}

function plainTextFromMarkdown(markdown = "") {
  return markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_`>#-]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

async function ensureCleanOutputDir() {
  await rm(dataDir, { recursive: true, force: true });
  await rm(postsDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(postsDir, { recursive: true });
}

async function fetchPostListPage(page, categoryNo) {
  const url = "https://blog.naver.com/PostTitleListAsync.naver";
  const response = await client.get(url, {
    params: {
      blogId: BLOG_ID,
      viewdate: "",
      currentPage: String(page),
      categoryNo,
      parentCategoryNo: "",
      countPerPage: String(COUNT_PER_PAGE)
    }
  });
  const data =
    typeof response.data === "string"
      ? JSON.parse(response.data.replace(/\\'/g, "'"))
      : response.data;

  if (data.resultCode !== "S") {
    throw new Error(`Failed to fetch post list: ${data.resultMessage || data.resultCode}`);
  }

  return data;
}

async function fetchAllPostsMeta() {
  const categorySummaries = [];
  const postsByLogNo = new Map();
  let blog;

  for (const categoryNo of CATEGORY_NOS) {
    const firstPage = await fetchPostListPage(1, categoryNo);
    const totalCount = Number(firstPage.totalCount ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / COUNT_PER_PAGE));
    const categoryPosts = [...(firstPage.postList ?? [])];

    blog ??= firstPage.blog;

    for (let page = 2; page <= totalPages; page += 1) {
      const pageData = await fetchPostListPage(page, categoryNo);
      categoryPosts.push(...(pageData.postList ?? []));
    }

    categorySummaries.push({
      categoryNo,
      totalCount,
      totalPages
    });

    for (const post of categoryPosts) {
      postsByLogNo.set(String(post.logNo), {
        logNo: String(post.logNo),
        title: decodeTitle(post.title),
        date: post.addDate,
        categoryNo: String(post.categoryNo),
        url: `https://blog.naver.com/${BLOG_ID}/${post.logNo}`,
        mobileUrl: `https://m.blog.naver.com/PostView.naver?blogId=${BLOG_ID}&logNo=${post.logNo}`
      });
    }
  }

  const posts = [...postsByLogNo.values()].sort((left, right) =>
    right.logNo.localeCompare(left.logNo)
  );
  const limitedPosts = MAX_POSTS > 0 ? posts.slice(0, MAX_POSTS) : posts;

  return {
    blog,
    categorySummaries,
    totalCount: limitedPosts.length,
    posts: limitedPosts
  };
}

function extractTextBlock($, $component) {
  const lines = $component
    .find(".se-text-paragraph")
    .map((_, element) => normalizeText($(element).text()))
    .get()
    .filter(Boolean);

  return lines.join("\n");
}

function extractImageBlock($component) {
  const image = $component.find("img.se-image-resource").first();
  const src = image.attr("data-lazy-src") || image.attr("src");
  const caption = normalizeText($component.find(".se-caption").text());

  if (!src) {
    return "";
  }

  const alt = markdownEscape(caption || "image");
  const lines = [`![${alt}](${src})`];

  if (caption) {
    lines.push(`*${caption}*`);
  }

  return lines.join("\n");
}

function extractOglinkBlock($component) {
  const title = normalizeText($component.find(".se-oglink-title").text());
  const summary = normalizeText($component.find(".se-oglink-summary").text());
  const href = $component.find("a.se-oglink-info").attr("href");

  if (!href) {
    return "";
  }

  const lines = [];

  if (title) {
    lines.push(`[${markdownEscape(title)}](${href})`);
  } else {
    lines.push(href);
  }

  if (summary) {
    lines.push(summary);
  }

  return lines.join("\n");
}

function extractVideoBlock($component) {
  const href =
    $component.find("a.se-video-link").attr("href") ||
    $component.find("a.__se_link").attr("href");
  const title = normalizeText($component.find(".se-module-video-title").text());

  if (!href) {
    return "";
  }

  return title ? `[${markdownEscape(title)}](${href})` : href;
}

function extractBlocks($) {
  const blocks = [];
  const components = $(".se-main-container > .se-component");

  components.each((_, element) => {
    const $component = $(element);
    let block = "";

    if ($component.hasClass("se-text")) {
      block = extractTextBlock($, $component);
    } else if ($component.hasClass("se-image")) {
      block = extractImageBlock($component);
    } else if ($component.hasClass("se-oglink")) {
      block = extractOglinkBlock($component);
    } else if ($component.hasClass("se-video")) {
      block = extractVideoBlock($component);
    } else {
      const text = normalizeText($component.text());
      if (text) {
        block = text;
      }
    }

    if (block) {
      blocks.push(block);
    }
  });

  if (blocks.length === 0) {
    const fallback = normalizeText($("#viewTypeSelector").text());
    if (fallback) {
      blocks.push(fallback);
    }
  }

  return blocks;
}

async function fetchPostDetail(post) {
  const { data: html } = await client.get(post.mobileUrl);
  const $ = load(html);

  const category = normalizeText($(".blog_category").first().text());
  const title =
    normalizeText($(".se-title-text .se-text-paragraph").first().text()) || post.title;
  const author = normalizeText($(".blog_author strong").first().text());
  const publishedAt = normalizeText($(".blog_date").first().text()) || post.date;
  const markdownBlocks = extractBlocks($);
  const markdown = markdownBlocks.join("\n\n").trim();
  const plainText = plainTextFromMarkdown(markdown);

  return {
    ...post,
    title,
    author,
    category,
    publishedAt,
    markdown,
    text: plainText
  };
}

function toMarkdownDocument(post) {
  const metadata = [
    `# ${post.title}`,
    "",
    `- Blog ID: ${BLOG_ID}`,
    `- Category: ${post.category || post.categoryNo}`,
    `- Category No: ${post.categoryNo}`,
    `- Author: ${post.author || ""}`,
    `- Published At: ${post.publishedAt || ""}`,
    `- URL: ${post.url}`,
    ""
  ];

  return [...metadata, post.markdown].join("\n").trim() + "\n";
}

async function saveOutputs(posts) {
  const index = posts.map((post) => ({
    logNo: post.logNo,
    title: post.title,
    author: post.author,
    category: post.category,
    categoryNo: post.categoryNo,
    publishedAt: post.publishedAt,
    url: post.url,
    file: `posts/${post.logNo}.md`,
    excerpt: post.text.slice(0, 220)
  }));

  const totalByCategory = posts.reduce((accumulator, post) => {
    const key = post.categoryNo;
    accumulator[key] ??= {
      categoryNo: post.categoryNo,
      category: post.category,
      totalPosts: 0
    };
    accumulator[key].totalPosts += 1;
    return accumulator;
  }, {});

  for (const post of posts) {
    const markdownPath = path.join(postsDir, `${post.logNo}.md`);
    await writeFile(markdownPath, toMarkdownDocument(post), "utf8");
  }

  await writeFile(
    path.join(dataDir, "posts.json"),
    `${JSON.stringify(
      {
        crawledAt: new Date().toISOString(),
        blogId: BLOG_ID,
        categoryNo: CATEGORY_NOS.join(","),
        categoryNos: CATEGORY_NOS,
        totalPosts: posts.length,
        totalByCategory: Object.values(totalByCategory),
        posts: index
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(dataDir, "full-posts.json"),
    `${JSON.stringify(
      {
        crawledAt: new Date().toISOString(),
        blogId: BLOG_ID,
        categoryNo: CATEGORY_NOS.join(","),
        categoryNos: CATEGORY_NOS,
        totalPosts: posts.length,
        totalByCategory: Object.values(totalByCategory),
        posts
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function main() {
  console.log(`Crawling blogId=${BLOG_ID}, categoryNos=${CATEGORY_NOS.join(",")}`);

  await ensureCleanOutputDir();

  const list = await fetchAllPostsMeta();
  const posts = [];

  for (const summary of list.categorySummaries) {
    console.log(
      `- Category ${summary.categoryNo}: ${summary.totalCount} posts across ${summary.totalPages} page(s)`
    );
  }

  for (const post of list.posts) {
    console.log(`- Fetching [${post.categoryNo}] ${post.logNo} ${post.title}`);
    const detail = await fetchPostDetail(post);
    posts.push(detail);
  }

  await saveOutputs(posts);

  console.log(`Saved ${posts.length} posts to ${postsDir}`);
  console.log(`Saved indexes to ${dataDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
