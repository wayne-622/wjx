#!/bin/bash
# 问卷星答案收集器 - 自动同步脚本
# 将本地最新文件同步到 GitHub 仓库并推送

set -e

REPO_DIR="C:/Users/wanjiahao/git/wjx-repo"
SOURCE_DIR="D:/Users/wanjiahao/Desktop/aaa/others/wjx"

echo "📦 同步文件..."
cp "$SOURCE_DIR/index.html" "$REPO_DIR/index.html"
cp "$SOURCE_DIR/collector.js" "$REPO_DIR/collector.js"

cd "$REPO_DIR"

# 检查是否有变更
if git diff --quiet && git diff --cached --quiet; then
    echo "✅ 文件无变化，无需推送"
    exit 0
fi

echo "📝 提交变更..."
git add index.html collector.js
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
git commit -m "sync: 更新问卷星收集器 ($TIMESTAMP)"

echo "🚀 推送到 GitHub..."
git push origin main

echo "✅ 同步完成！"
