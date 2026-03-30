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

const DEFAULT_TARGETS = [
  { blogId: "cha_j212", categoryNos: ["16", "17"] },
  { blogId: "songkh87", categoryNos: ["28"] }
];
const COUNT_PER_PAGE = Number(process.env.COUNT_PER_PAGE ?? "30");
const MOBILE_COUNT_PER_PAGE = Number(process.env.MOBILE_COUNT_PER_PAGE ?? "10");
const MAX_POSTS = Number(process.env.MAX_POSTS ?? "0");

const client = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    Accept: "text/html,application/json"
  },
  timeout: 20000
});

function parseCategoryNos(input, fallback = []) {
  const categoryNos = [...new Set((input ?? "").split(",").map((value) => value.trim()))].filter(
    Boolean
  );

  return categoryNos.length > 0 ? categoryNos : fallback;
}

function parseTargets() {
  const targetInput = process.env.NAVER_TARGETS?.trim();

  if (targetInput) {
    const targets = targetInput
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [blogId, categoryInput = ""] = entry.split(":");
        const categoryNos = parseCategoryNos(categoryInput);

        if (!blogId?.trim() || categoryNos.length === 0) {
          throw new Error(
            `Invalid NAVER_TARGETS entry "${entry}". Use blogId:category1,category2`
          );
        }

        return {
          blogId: blogId.trim(),
          categoryNos
        };
      });

    if (targets.length === 0) {
      throw new Error("NAVER_TARGETS did not include any crawl targets.");
    }

    return targets;
  }

  if (
    process.env.NAVER_BLOG_ID ||
    process.env.NAVER_CATEGORY_NOS ||
    process.env.NAVER_CATEGORY_NO
  ) {
    return [
      {
        blogId: process.env.NAVER_BLOG_ID?.trim() || DEFAULT_TARGETS[0].blogId,
        categoryNos: parseCategoryNos(
          process.env.NAVER_CATEGORY_NOS ?? process.env.NAVER_CATEGORY_NO,
          DEFAULT_TARGETS[0].categoryNos
        )
      }
    ];
  }

  return DEFAULT_TARGETS;
}

const TARGETS = parseTargets();

function decodeTitle(value = "") {
  const normalized = value.replace(/\+/g, " ");
  let decodedValue = normalized;

  try {
    decodedValue = decodeURIComponent(normalized);
  } catch {
    decodedValue = normalized;
  }

  return decodeHtml(decodedValue)
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

function mobileHeaders(blogId) {
  return {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    Referer: `https://m.blog.naver.com/PostList.naver?blogId=${blogId}`
  };
}

async function fetchBlogInfo(blogId) {
  const response = await client.get(`https://m.blog.naver.com/api/blogs/${blogId}`, {
    headers: mobileHeaders(blogId)
  });
  const data = typeof response.data === "string" ? JSON.parse(response.data) : response.data;

  if (!data.isSuccess) {
    throw new Error(`Failed to fetch blog info for ${blogId}`);
  }

  return data.result;
}

async function fetchCategoryList(blogId) {
  const response = await client.get(`https://m.blog.naver.com/api/blogs/${blogId}/category-list`, {
    headers: mobileHeaders(blogId)
  });
  const data = typeof response.data === "string" ? JSON.parse(response.data) : response.data;

  if (!data.isSuccess) {
    throw new Error(`Failed to fetch category list for ${blogId}`);
  }

  return data.result.mylogCategoryList ?? [];
}

async function fetchPostListPageDesktop(blogId, page, categoryNo) {
  const url = "https://blog.naver.com/PostTitleListAsync.naver";
  const response = await client.get(url, {
    params: {
      blogId,
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

async function fetchPostListPageMobile(blogId, page, categoryNo) {
  const response = await client.get(`https://m.blog.naver.com/api/blogs/${blogId}/post-list`, {
    params: {
      page: String(page),
      categoryNo
    },
    headers: mobileHeaders(blogId)
  });
  const data = typeof response.data === "string" ? JSON.parse(response.data) : response.data;

  if (!data.isSuccess) {
    throw new Error(`Failed to fetch mobile post list for ${blogId}/${categoryNo}`);
  }

  return data.result;
}

function normalizePostMeta(blogId, post, requestedCategoryNo) {
  return {
    blogId,
    logNo: String(post.logNo),
    title: decodeTitle(post.titleWithInspectMessage ?? post.title ?? ""),
    date: post.addDate,
    category: normalizeText(post.categoryName ?? ""),
    categoryNo: String(post.categoryNo ?? requestedCategoryNo),
    requestedCategoryNo: String(requestedCategoryNo),
    url: `https://blog.naver.com/${blogId}/${post.logNo}`,
    mobileUrl: `https://m.blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${post.logNo}`
  };
}

async function fetchCategoryPostsViaMobile(blogId, categoryNo, expectedCount) {
  const posts = [];
  const seen = new Set();
  let page = 1;
  let pageSize = MOBILE_COUNT_PER_PAGE;

  while (true) {
    const pageData = await fetchPostListPageMobile(blogId, page, categoryNo);
    const items = pageData.items ?? [];
    pageSize = items.length || pageSize;

    for (const item of items) {
      const logNo = String(item.logNo);
      if (seen.has(logNo)) {
        continue;
      }

      seen.add(logNo);
      posts.push(item);
    }

    if (items.length === 0) {
      break;
    }

    if (expectedCount > 0 && posts.length >= expectedCount) {
      break;
    }

    if (items.length < pageSize) {
      break;
    }

    page += 1;
  }

  return {
    totalCount: expectedCount > 0 ? expectedCount : posts.length,
    totalPages: page,
    posts
  };
}

async function fetchAllPostsMeta(target) {
  const { blogId, categoryNos } = target;
  const blog = await fetchBlogInfo(blogId).catch(() => ({ blogId }));
  const categoryList = await fetchCategoryList(blogId);
  const categoryByNo = new Map(categoryList.map((category) => [String(category.categoryNo), category]));
  const categorySummaries = [];
  const postsByLogNo = new Map();

  for (const categoryNo of categoryNos) {
    const categoryInfo = categoryByNo.get(categoryNo);
    let totalCount = Number(categoryInfo?.postCnt ?? 0);
    let totalPages = 0;
    let categoryPosts = [];
    let source = "desktop";

    try {
      const firstPage = await fetchPostListPageDesktop(blogId, 1, categoryNo);
      totalCount = Number(firstPage.totalCount ?? categoryInfo?.postCnt ?? 0);
      totalPages = Math.max(1, Math.ceil(totalCount / COUNT_PER_PAGE));
      categoryPosts = [...(firstPage.postList ?? [])];

      for (let page = 2; page <= totalPages; page += 1) {
        const pageData = await fetchPostListPageDesktop(blogId, page, categoryNo);
        categoryPosts.push(...(pageData.postList ?? []));
      }
    } catch {
      source = "mobile";
      const mobileData = await fetchCategoryPostsViaMobile(blogId, categoryNo, totalCount);
      totalCount = mobileData.totalCount;
      totalPages = mobileData.totalPages;
      categoryPosts = mobileData.posts;
    }

    categorySummaries.push({
      categoryNo,
      categoryName: categoryInfo?.categoryName ?? "",
      totalCount,
      totalPages,
      source
    });

    for (const post of categoryPosts) {
      postsByLogNo.set(String(post.logNo), normalizePostMeta(blogId, post, categoryNo));
    }
  }

  const posts = [...postsByLogNo.values()].sort((left, right) =>
    right.logNo.localeCompare(left.logNo)
  );
  const limitedPosts = MAX_POSTS > 0 ? posts.slice(0, MAX_POSTS) : posts;

  return {
    blog,
    blogId,
    categoryNos,
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
    `- Blog ID: ${post.blogId}`,
    `- Category: ${post.category || post.categoryNo}`,
    `- Category No: ${post.categoryNo}`,
    `- Author: ${post.author || ""}`,
    `- Published At: ${post.publishedAt || ""}`,
    `- URL: ${post.url}`,
    ""
  ];

  return [...metadata, post.markdown].join("\n").trim() + "\n";
}

function buildIndex(posts) {
  return posts.map((post) => ({
    blogId: post.blogId,
    logNo: post.logNo,
    title: post.title,
    author: post.author,
    category: post.category,
    categoryNo: post.categoryNo,
    requestedCategoryNo: post.requestedCategoryNo,
    publishedAt: post.publishedAt,
    url: post.url,
    file: `posts/${post.blogId}/${post.logNo}.md`,
    excerpt: post.text.slice(0, 220)
  }));
}

function buildTotalByCategory(posts) {
  return Object.values(
    posts.reduce((accumulator, post) => {
      const key = post.categoryNo;
      accumulator[key] ??= {
        categoryNo: post.categoryNo,
        category: post.category,
        totalPosts: 0
      };
      accumulator[key].totalPosts += 1;
      return accumulator;
    }, {})
  );
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildBlogPayload(result, crawledAt, posts) {
  return {
    crawledAt,
    blogId: result.blogId,
    blogName: result.blog?.blogName ?? "",
    categoryNo: result.categoryNos.join(","),
    categoryNos: result.categoryNos,
    categorySummaries: result.categorySummaries,
    totalPosts: posts.length,
    totalByCategory: buildTotalByCategory(posts),
    posts
  };
}

async function saveOutputs(results) {
  const crawledAt = new Date().toISOString();
  const allPosts = [];

  for (const result of results) {
    const blogPostsDir = path.join(postsDir, result.blogId);
    const blogDataDir = path.join(dataDir, result.blogId);
    const index = buildIndex(result.posts);

    await mkdir(blogPostsDir, { recursive: true });
    await mkdir(blogDataDir, { recursive: true });

    for (const post of result.posts) {
      const markdownPath = path.join(blogPostsDir, `${post.logNo}.md`);
      await writeFile(markdownPath, toMarkdownDocument(post), "utf8");
    }

    await writeJson(
      path.join(blogDataDir, "posts.json"),
      buildBlogPayload(result, crawledAt, index)
    );

    await writeJson(
      path.join(blogDataDir, "full-posts.json"),
      buildBlogPayload(result, crawledAt, result.posts)
    );

    allPosts.push(...result.posts);
  }

  const sortedAllPosts = [...allPosts].sort((left, right) => {
    if (left.blogId !== right.blogId) {
      return left.blogId.localeCompare(right.blogId);
    }

    return right.logNo.localeCompare(left.logNo);
  });
  const index = buildIndex(sortedAllPosts);

  await writeJson(
    path.join(dataDir, "posts.json"),
    {
      crawledAt,
      totalPosts: sortedAllPosts.length,
      totalByBlog: results.map((result) => ({
        blogId: result.blogId,
        blogName: result.blog?.blogName ?? "",
        categoryNos: result.categoryNos,
        totalPosts: result.posts.length,
        dataFile: `data/${result.blogId}/posts.json`
      })),
      posts: index
    }
  );

  await writeJson(
    path.join(dataDir, "full-posts.json"),
    {
      crawledAt,
      totalPosts: sortedAllPosts.length,
      totalByBlog: results.map((result) => ({
        blogId: result.blogId,
        blogName: result.blog?.blogName ?? "",
        categoryNos: result.categoryNos,
        totalPosts: result.posts.length
      })),
      posts: sortedAllPosts
    }
  );
}

async function main() {
  await ensureCleanOutputDir();
  const results = [];

  for (const target of TARGETS) {
    console.log(`Crawling blogId=${target.blogId}, categoryNos=${target.categoryNos.join(",")}`);

    const list = await fetchAllPostsMeta(target);
    const posts = [];

    for (const summary of list.categorySummaries) {
      console.log(
        `- ${target.blogId} category ${summary.categoryNo} (${summary.categoryName || "unknown"}): ${summary.totalCount} posts across ${summary.totalPages} page(s) via ${summary.source}`
      );
    }

    for (const post of list.posts) {
      console.log(`- Fetching [${post.blogId}/${post.categoryNo}] ${post.logNo} ${post.title}`);
      const detail = await fetchPostDetail(post);
      posts.push(detail);
    }

    results.push({
      ...list,
      posts
    });
  }

  await saveOutputs(results);

  const totalPosts = results.reduce((sum, result) => sum + result.posts.length, 0);

  console.log(`Saved ${totalPosts} posts to ${postsDir}`);
  console.log(`Saved indexes to ${dataDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
