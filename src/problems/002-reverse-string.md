---
id: 2
title: Reverse String
difficulty: Easy
description: Write a function that reverses a string in-place.
examples:
  - input: "s = [\"h\",\"e\",\"l\",\"l\",\"o\"]"
    output: "[\"o\",\"l\",\"l\",\"e\",\"h\"]"
  - input: "s = [\"H\",\"a\",\"n\",\"n\",\"a\",\"h\"]"
    output: "[\"h\",\"a\",\"n\",\"n\",\"a\",\"H\"]"
constraints:
  - "1 <= s.length <= 10^5"
  - "s[i] is a printable ascii character"
testCases:
  - input: {"s": ["h","e","l","l","o"]}
    expected: ["o","l","l","e","h"]
  - input: {"s": ["H","a","n","n","a","h"]}
    expected: ["h","a","n","n","a","H"]
  - input: {"s": ["A"]}
    expected: ["A"]
templates:
  javascript: |
    function solution(input) {
      const { s } = input;
      // Modify the array in-place and return it
      return s;
    }
  typescript: |
    function solution(input: { s: string[] }): string[] {
      const { s } = input;
      // Modify the array in-place and return it
      return s;
    }
  python: |
    def solution(input):
        s = input['s']
        # Modify the list in-place and return it
        return s
  racket: |
    #lang racket

    (define (solution input)
      (let ([s (hash-ref input 's)])
        ;; Your code here
        s))
---

## 题目

编写一个函数，将输入的字符数组 `s` **原地反转**。

要求：使用 $O(1)$ 额外空间。
