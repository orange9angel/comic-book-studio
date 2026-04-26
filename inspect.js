#!/usr/bin/env node
/**
 * Comic Book Studio — 闭环质量检查系统 (Quality Inspector)
 *
 * 检测维度：
 * 1. 场景完整性 — caption 与画面元素是否匹配
 * 2. 剧情连贯性 — 时间/空间/因果逻辑是否自洽
 * 3. 人物一致性 — 角色行为/情绪是否符合人设
 * 4. 音频可生成性 — 语音配置是否完整
 * 5. 视觉可渲染性 — 图片/路径是否存在
 */

import fs from "fs";
import path from "path";

const episodeArg = process.argv.find((arg) => arg.startsWith("--episode="));
const episode = episodeArg ? episodeArg.slice("--episode=".length) : "";
const ROOT = episode ? path.join(process.cwd(), episode) : process.cwd();
const storyPath = path.join(ROOT, "story.json");
const voiceConfigPath = path.join(ROOT, "voice_config.json");
const assetsDir = path.join(ROOT, "assets");

// ==================== 角色人设库 ====================
const CHARACTER_PROFILES = {
  "小岚": {
    description: "活泼好奇的小女孩，穿黄色雨衣，蓝色围巾",
    traits: ["勇敢", "善良", "好奇", "乐于助人"],
    validEmotions: ["surprised", "curious", "excited", "friendly", "sad", "cheerful", "neutral"],
    neverDoes: ["说机械术语", "表现出冷漠"],
    usuallyWith: ["豆豆"],
  },
  "豆豆": {
    description: "小型机器人伙伴，圆滚滚，头顶天线",
    traits: ["忠诚", "机械感", "辅助", "可爱"],
    validEmotions: ["excited", "neutral", "cheerful", "curious"],
    neverDoes: ["表现出恐惧", "说伤感的话"],
    tone: "robot",
    usuallyWith: ["小岚"],
  },
  "小星星": {
    description: "迷路的星星精灵，发光，可爱",
    traits: ["温柔", "梦幻", "需要帮助"],
    validEmotions: ["sad", "cheerful", "friendly", "neutral"],
    neverDoes: ["说粗俗的话", "表现愤怒"],
    tone: "star",
    usuallyWith: [], // 被帮助的对象
  },
  "旁白": {
    description: "叙事者",
    traits: ["沉稳", "客观"],
    validEmotions: ["neutral"],
    neverDoes: [],
  },
};

// ==================== 场景元素关键词库 ====================
const SCENE_ELEMENTS = {
  // 环境特征
  "雨夜": { keywords: ["雨", "夜晚", " wet", "rain", "night"], related: ["街道", "灯光", "倒影"] },
  "街道": { keywords: ["街", "路", "建筑", "城市", "street", "city"], related: ["雨夜", "灯光"] },
  "阁楼": { keywords: ["阁楼", "室内", "屋顶", "attic", "room", "室内"], related: ["星图", "灯光", "桌子"] },
  "夜空": { keywords: ["夜", "天空", "星", "云", "night", "sky", "star"], related: ["飞行", "城市"] },
  "飞行": { keywords: ["飞", "空中", "纸船", "fly", "sky"], related: ["夜空", "城市"] },
  "乌云": { keywords: ["云", "暗", "storm", "cloud", "dark"], related: ["雨", "星星"] },
  "清晨": { keywords: ["晨", "日出", "阳光", "morning", "sunrise"], related: ["天空", "城市"] },
  "屋顶": { keywords: ["顶", "天台", "rooftop", "roof"], related: ["城市", "清晨"] },
};

// ==================== 剧情逻辑规则 ====================
const STORY_RULES = {
  // 时间流转规则
  timeFlow: [
    { from: "雨夜", to: "阁楼", valid: true, note: "从街道回到室内" },
    { from: "阁楼", to: "夜空", valid: true, note: "从室内到空中" },
    { from: "夜空", to: "乌云", valid: true, note: "飞行中进入乌云" },
    { from: "乌云", to: "清晨", valid: true, note: "雨过天晴到日出" },
  ],
  // 角色出场规则
  characterPresence: {
    "小岚": { required: true, note: "主角必须全程在场" },
    "豆豆": { required: true, note: "伙伴机器人应全程跟随" },
  },
};

// ==================== 检查结果类 ====================
class InspectorResult {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.infos = [];
  }

  error(page, category, message, detail = "") {
    this.errors.push({ page, category, message, detail });
  }

  warn(page, category, message, detail = "") {
    this.warnings.push({ page, category, message, detail });
  }

  info(page, category, message, detail = "") {
    this.infos.push({ page, category, message, detail });
  }

  hasIssues() {
    return this.errors.length > 0 || this.warnings.length > 0;
  }

  summary() {
    return {
      errors: this.errors.length,
      warnings: this.warnings.length,
      infos: this.infos.length,
    };
  }
}

// ==================== 检查器 ====================

function inspectVisualAssets(story, result) {
  for (let i = 0; i < story.pages.length; i++) {
    const page = story.pages[i];
    const imgPath = path.join(ROOT, page.image);
    if (!fs.existsSync(imgPath)) {
      result.error(i + 1, "视觉", `图片不存在: ${page.image}`);
    }
  }
}

function inspectSceneCompleteness(story, result) {
  for (let i = 0; i < story.pages.length; i++) {
    const page = story.pages[i];
    const caption = page.caption || "";
    const bubbles = page.bubbles || [];
    const allText = [caption, ...bubbles.map((b) => b.text)].join(" ");

    // 1. 检查 caption 是否为空或过短
    if (!caption || caption.length < 5) {
      result.warn(i + 1, "场景", "旁白描述过短，建议补充场景细节");
    }

    // 2. 检查场景元素一致性 —— caption 提到的元素是否在对白中有呼应
    const sceneTags = extractSceneTags(caption, page.scene_tags);
    for (const tag of sceneTags) {
      const element = SCENE_ELEMENTS[tag];
      if (!element) continue;

      // 检查对白中是否有相关元素提及
      const hasRelatedMention = bubbles.some((b) =>
        element.related.some((rel) => b.text.includes(rel))
      );
      if (!hasRelatedMention && bubbles.length > 0) {
        result.info(
          i + 1,
          "场景",
          `场景「${tag}」在对白中缺少相关元素呼应`,
          `建议对白提及: ${element.related.join(", ")}`
        );
      }
    }

    // 3. 检查画面-文字矛盾（基于关键词反查）
    checkCaptionImageConsistency(i + 1, caption, allText, result);
  }
}

function extractSceneTags(caption, sceneTags = []) {
  // 优先使用显式声明的 scene_tags
  if (sceneTags && sceneTags.length > 0) {
    return sceneTags;
  }
  // 否则从 caption 中提取
  const tags = [];
  for (const [tag, data] of Object.entries(SCENE_ELEMENTS)) {
    if (data.keywords.some((kw) => caption.includes(kw))) {
      tags.push(tag);
    }
  }
  return tags;
}

function checkCaptionImageConsistency(pageNum, caption, allText, result) {
  // 检查 caption 中提到的关键物体是否在对白中有所体现
  // 例如：caption 说"雨线缠住"，但对白说"找不到回家的路"——可能不一致

  const contradictions = [
    {
      captionPattern: /雨线|雨丝|rain/i,
      textPattern: /藤蔓|枝条|树枝|藤|vine|branch/i,
      message: "caption 提到'雨线'，但对白/画面可能显示为'藤蔓'",
      severity: "warn",
    },
    {
      captionPattern: /捡到|拾起|pick/i,
      textPattern: /发光|信号|glow|signal/i,
      message: "caption 说'捡到'，但对白强调'发光/信号'——需确认画面重点",
      severity: "info",
    },
  ];

  for (const check of contradictions) {
    if (check.captionPattern.test(caption) && check.textPattern.test(allText)) {
      if (check.severity === "warn") {
        result.warn(pageNum, "场景一致性", check.message);
      } else {
        result.info(pageNum, "场景一致性", check.message);
      }
    }
  }
}

function inspectStoryCoherence(story, result) {
  const pages = story.pages;

  // 1. 检查时间线连贯性
  const timeMarkers = [];
  for (let i = 0; i < pages.length; i++) {
    const caption = pages[i].caption || "";
    let time = null;
    // 按优先级匹配时间标记（更具体的先匹配）
    if (/乌云|storm|thunder/i.test(caption)) time = "乌云";
    else if (/阁楼|室内|indoor|attic/i.test(caption)) time = "阁楼";
    else if (/飞|空中|fly/i.test(caption)) time = "夜空";
    else if (/晨|日出|morning|sunrise|天晴/i.test(caption)) time = "清晨";
    else if (/雨|夜|晚|night|rain/i.test(caption)) time = "雨夜";
    else if (/云|sky/i.test(caption)) time = "夜空";

    if (time) timeMarkers.push({ page: i + 1, time });
  }

  // 检查相邻场景的时间流转是否合理
  for (let i = 1; i < timeMarkers.length; i++) {
    const prev = timeMarkers[i - 1];
    const curr = timeMarkers[i];
    const rule = STORY_RULES.timeFlow.find(
      (r) => r.from === prev.time && r.to === curr.time
    );
    if (!rule) {
      result.warn(
        curr.page,
        "剧情连贯",
        `时间流转可能突兀: ${prev.time} → ${curr.time}`,
        `第${prev.page}页是${prev.time}，第${curr.page}页突然到${curr.time}，建议添加过渡`
      );
    }
  }

  // 2. 检查因果逻辑
  for (let i = 1; i < pages.length; i++) {
    const prevBubbles = pages[i - 1].bubbles || [];
    const currBubbles = pages[i].bubbles || [];
    const prevLastSpeaker =
      prevBubbles.length > 0
        ? prevBubbles[prevBubbles.length - 1].speaker
        : null;
    const currFirstSpeaker =
      currBubbles.length > 0 ? currBubbles[0].speaker : null;

    // 检查对话衔接：如果上一页最后和当前页第一人是同一人，应该有连贯性
    if (
      prevLastSpeaker &&
      currFirstSpeaker &&
      prevLastSpeaker === currFirstSpeaker &&
      prevLastSpeaker !== "旁白"
    ) {
      const prevLastText = prevBubbles[prevBubbles.length - 1].text;
      const currFirstText = currBubbles[0].text;
      // 简单检查：如果两句话完全不相关，提示
      const prevKeywords = extractKeywords(prevLastText);
      const currKeywords = extractKeywords(currFirstText);
      const overlap = prevKeywords.filter((k) => currKeywords.includes(k));
      if (overlap.length === 0 && prevLastText.length > 3 && currFirstText.length > 3) {
        result.info(
          i + 1,
          "剧情连贯",
          `跨页对话衔接可能断裂`,
          `第${i}页末尾「${prevLastText.slice(0, 15)}...」与第${i + 1}页开头「${currFirstText.slice(0, 15)}...」话题跳跃较大`
        );
      }
    }
  }

  // 3. 检查故事完整性：开头-发展-高潮-结尾
  if (pages.length < 3) {
    result.warn(0, "剧情结构", "页数过少，故事可能不完整");
  }
}

function extractKeywords(text) {
  // 提取关键词（名词、动词）
  const words = text.split(/[，。！？、\s]+/);
  const keywords = [];
  for (const w of words) {
    if (w.length >= 2) keywords.push(w);
  }
  return keywords;
}

function inspectCharacterConsistency(story, result) {
  const pages = story.pages;
  const characterAppearances = {}; // 角色 -> [页码]

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const bubbles = page.bubbles || [];
    const pageSpeakers = new Set();

    for (const bubble of bubbles) {
      const speaker = bubble.speaker;
      const emotion = bubble.emotion || "neutral";
      const tone = bubble.tone || "";
      const text = bubble.text || "";

      // 记录出场
      if (!characterAppearances[speaker]) characterAppearances[speaker] = [];
      characterAppearances[speaker].push(i + 1);
      pageSpeakers.add(speaker);

      // 1. 检查未知角色（对新故事宽容处理）
      if (!CHARACTER_PROFILES[speaker]) {
        result.info(i + 1, "人物", `新角色: ${speaker}`, "请在 voice_config.json 中配置该角色声线");
        continue;
      }

      const profile = CHARACTER_PROFILES[speaker];

      // 2. 检查情绪是否合法
      if (profile.validEmotions && !profile.validEmotions.includes(emotion)) {
        result.warn(
          i + 1,
          "人物",
          `角色「${speaker}」的情绪「${emotion}」不符合人设`,
          `${speaker} 通常表现: ${profile.validEmotions.join(", ")}`
        );
      }

      // 3. 检查 tone 是否匹配
      if (profile.tone && tone && profile.tone !== tone) {
        result.warn(
          i + 1,
          "人物",
          `角色「${speaker}」的 tone「${tone}」与预设「${profile.tone}」不符`
        );
      }

      // 4. 检查角色禁忌行为
      if (profile.neverDoes) {
        for (const forbidden of profile.neverDoes) {
          if (text.includes(forbidden.replace("说", "").replace("表现出", ""))) {
            result.warn(
              i + 1,
              "人物",
              `角色「${speaker}」可能违反人设`,
              `${speaker} 不应该: ${forbidden}`
            );
          }
        }
      }
    }

    // 5. 检查角色关系：某些角色应该一起出现
    for (const [char, profile] of Object.entries(CHARACTER_PROFILES)) {
      if (profile.usuallyWith && pageSpeakers.has(char)) {
        for (const companion of profile.usuallyWith) {
          if (!pageSpeakers.has(companion)) {
            result.info(
              i + 1,
              "人物",
              `角色「${char}」出现时，伙伴「${companion}」未在本页对白中出现`,
              `建议确认画面是否包含 ${companion}`
            );
          }
        }
      }
    }
  }

  // 6. 检查主要角色出场覆盖率（只对已知角色）
  for (const [char, appearances] of Object.entries(characterAppearances)) {
    if (!CHARACTER_PROFILES[char]) continue;
    const profile = CHARACTER_PROFILES[char];
    if (profile.required) {
      const missingPages = [];
      for (let i = 1; i <= pages.length; i++) {
        if (!appearances.includes(i)) missingPages.push(i);
      }
      if (missingPages.length > 0) {
        result.info(
          0,
          "人物",
          `角色「${char}」在第 ${missingPages.join(", ")} 页无对白`,
          `建议确认剧情合理性`
        );
      }
    }
  }

  // 7. 检查新角色引入是否有铺垫
  for (const [char, pages_] of Object.entries(characterAppearances)) {
    if (char === "旁白" || char === "小岚" || char === "豆豆") continue;
    const firstAppearance = Math.min(...pages_);
    if (firstAppearance > 1) {
      result.info(
        firstAppearance,
        "人物",
        `新角色「${char}」首次出场`,
        `建议在前文有铺垫或介绍`
      );
    }
  }
}

function inspectAudioFeasibility(story, result) {
  if (!fs.existsSync(voiceConfigPath)) {
    result.error(0, "音频", "voice_config.json 不存在");
    return;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(voiceConfigPath, "utf-8"));
  } catch (e) {
    result.error(0, "音频", "voice_config.json 解析失败", e.message);
    return;
  }

  const roles = config.roles || {};
  const emotionMap = config.emotion_map || {};

  // 收集所有用到的角色和情绪
  const usedSpeakers = new Set();
  const usedEmotions = new Set();

  for (const page of story.pages) {
    for (const bubble of page.bubbles || []) {
      usedSpeakers.add(bubble.speaker || "旁白");
      usedEmotions.add(bubble.emotion || "neutral");
    }
    if (page.caption) usedSpeakers.add("旁白");
  }

  // 检查每个角色是否有配置
  for (const speaker of usedSpeakers) {
    if (!roles[speaker]) {
      result.error(0, "音频", `角色「${speaker}」在 voice_config.json 中无声音配置`);
    }
  }

  // 检查每个情绪是否有配置
  for (const emotion of usedEmotions) {
    if (!emotionMap[emotion]) {
      result.warn(0, "音频", `情绪「${emotion}」在 voice_config.json 中无映射配置`);
    }
  }
}

function inspectTiming(story, result) {
  const pages = story.pages;
  const totalDuration = story.totalDuration || 0;

  // 1. 检查时间轴连续性
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page.start === undefined || page.end === undefined) {
      result.error(i + 1, "时间轴", `第 ${i + 1} 页缺少 start/end 时间`);
      continue;
    }
    if (page.end <= page.start) {
      result.error(i + 1, "时间轴", `第 ${i + 1} 页 end(${page.end}) <= start(${page.start})`);
    }
    if (i > 0 && page.start !== pages[i - 1].end) {
      result.warn(
        i + 1,
        "时间轴",
        `第 ${i} 页结束(${pages[i - 1].end}) ≠ 第 ${i + 1} 页开始(${page.start})`
      );
    }
  }

  // 2. 检查最后一页是否覆盖到 totalDuration
  if (pages.length > 0) {
    const lastPage = pages[pages.length - 1];
    if (lastPage.end < totalDuration) {
      result.warn(
        pages.length,
        "时间轴",
        `最后一页结束时间(${lastPage.end}s) < 总时长(${totalDuration}s)`,
        `视频末尾将有 ${(totalDuration - lastPage.end).toFixed(1)}s 空白`
      );
    }
  }

  // 3. 检查每页时长是否足够放下内容
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const duration = page.end - page.start;
    const bubbles = page.bubbles || [];
    const caption = page.caption || "";

    // 粗略估算：每个气泡至少 2 秒，旁白至少 3 秒
    const minNeeded = (caption ? 3 : 0) + bubbles.length * 2;
    if (duration < minNeeded) {
      result.warn(
        i + 1,
        "时间轴",
        `第 ${i + 1} 页时长(${duration.toFixed(1)}s)可能不足以展示所有内容`,
        `建议至少 ${minNeeded}s（${bubbles.length} 个气泡 + 旁白）`
      );
    }
  }
}

// ==================== 主入口 ====================

function main() {
  console.log("=" .repeat(60));
  console.log("Comic Book Studio — 闭环质量检查系统");
  console.log("=" .repeat(60));

  if (!fs.existsSync(storyPath)) {
    console.error("❌ story.json 不存在");
    process.exit(1);
  }

  let story;
  try {
    story = JSON.parse(fs.readFileSync(storyPath, "utf-8"));
  } catch (e) {
    console.error("❌ story.json 解析失败:", e.message);
    process.exit(1);
  }

  const result = new InspectorResult();

  console.log(`\n📖 故事: ${story.title || "未命名"}`);
  console.log(`📄 页数: ${story.pages?.length || 0}`);
  console.log(`⏱️  总时长: ${story.totalDuration || "未设置"}s\n`);

  console.log("🔍 开始检查...\n");

  inspectVisualAssets(story, result);
  inspectSceneCompleteness(story, result);
  inspectStoryCoherence(story, result);
  inspectCharacterConsistency(story, result);
  inspectAudioFeasibility(story, result);
  inspectTiming(story, result);

  // 输出结果
  const { errors, warnings, infos } = result.summary();

  console.log("\n" + "=".repeat(60));
  console.log("📊 检查结果");
  console.log("=".repeat(60));

  if (errors > 0) {
    console.log(`\n❌ 错误 (${errors}):`);
    for (const e of result.errors) {
      const pageStr = e.page > 0 ? `第${e.page}页` : "全局";
      console.log(`   [${pageStr}] [${e.category}] ${e.message}`);
      if (e.detail) console.log(`      → ${e.detail}`);
    }
  }

  if (warnings > 0) {
    console.log(`\n⚠️  警告 (${warnings}):`);
    for (const w of result.warnings) {
      const pageStr = w.page > 0 ? `第${w.page}页` : "全局";
      console.log(`   [${pageStr}] [${w.category}] ${w.message}`);
      if (w.detail) console.log(`      → ${w.detail}`);
    }
  }

  if (infos > 0) {
    console.log(`\nℹ️  提示 (${infos}):`);
    for (const info of result.infos) {
      const pageStr = info.page > 0 ? `第${info.page}页` : "全局";
      console.log(`   [${pageStr}] [${info.category}] ${info.message}`);
      if (info.detail) console.log(`      → ${info.detail}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  if (errors === 0 && warnings === 0) {
    console.log("✅ 全部通过！未发现明显问题。");
  } else if (errors === 0) {
    console.log(`⚠️  共 ${warnings} 个警告，建议修复后再渲染。`);
  } else {
    console.log(`❌ 共 ${errors} 个错误、${warnings} 个警告，必须修复错误后才能渲染。`);
    process.exit(1);
  }
  console.log("=".repeat(60));
}

main();
