const n=`---
id: 6
title: Longest Substring Without Repeating Characters
difficulty: Medium
description: Find the length of the longest substring without repeating characters.
examples:
  - input: "s = \\"abcabcbb\\""
    output: "3"
    explanation: "The answer is \\"abc\\", with the length of 3."
  - input: "s = \\"bbbbb\\""
    output: "1"
constraints:
  - "0 <= s.length <= 5 * 10^4"
  - "s consists of English letters, digits, symbols and spaces"
testCases:
  - input: {"s": "abcabcbb"}
    expected: 3
  - input: {"s": "bbbbb"}
    expected: 1
  - input: {"s": "pwwkew"}
    expected: 3
templates:
  javascript: |
    function solution(input) {
      const { s } = input;
      // Your code here
      return 0;
    }
  typescript: |
    function solution(input: { s: string }): number {
      const { s } = input;
      // Your code here
      return 0;
    }
  python: |
    def solution(input):
        s = input['s']
        # Your code here
        return 0
  racket: |
    #lang racket

    (define (solution input)
      (let ([s (hash-ref input 's)])
        ;; Your code here
        0))
---

## 题目

给定字符串 \`s\`，请你找出其中不含有重复字符的 **最长子串的长度**。
`;export{n as default};
