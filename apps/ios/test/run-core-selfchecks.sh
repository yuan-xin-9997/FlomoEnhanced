#!/usr/bin/env bash
set -euo pipefail
ios_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/flomo-core-check.XXXXXX")"
trap 'rm -rf -- "$scratch"' EXIT

# 直接编译现有纯函数，排除依赖 iOS 的 SwiftUI 控件。
sed '/^\/\/ MARK: - 字段表单/,$d' "$ios_root/FlomoEnhanced/Features/Memos/MemoFieldForm.swift" > "$scratch/MemoFieldDraft.swift"
sed -n '/^enum MemoNumberText {$/,$p' "$ios_root/FlomoEnhanced/Features/Memos/MemoSupport.swift" > "$scratch/MemoNumberText.swift"

core="$ios_root/FlomoEnhanced/Core"
xcrun swiftc \
  "$core/Models.swift" "$core/FieldValue.swift" "$core/FieldTypes.swift" \
  "$core/FieldFormat.swift" "$core/Normalize.swift" "$core/Dates.swift" \
  "$core/APIError.swift" "$core/AnalyticsModels.swift" "$core/APIClient.swift" \
  "$scratch/MemoFieldDraft.swift" "$scratch/MemoNumberText.swift" \
  "$ios_root/FlomoEnhanced/Features/Memos/MemoTextCodec.swift" \
  "$ios_root/test/CoreSelfChecks.swift" -o "$scratch/selfchecks"
"$scratch/selfchecks"
