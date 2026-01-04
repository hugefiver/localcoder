---
id: 1
title: Two Sum
difficulty: Easy
description: Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.
examples:
  - input: "nums = [2,7,11,15], target = 9"
    output: "[0,1]"
    explanation: "Because nums[0] + nums[1] == 9, we return [0, 1]."
  - input: "nums = [3,2,4], target = 6"
    output: "[1,2]"
constraints:
  - "2 <= nums.length <= 10^4"
  - "-10^9 <= nums[i] <= 10^9"
  - "-10^9 <= target <= 10^9"
testCases:
  - input: {"nums": [2,7,11,15], "target": 9}
    expected: [0,1]
  - input: {"nums": [3,2,4], "target": 6}
    expected: [1,2]
  - input: {"nums": [3,3], "target": 6}
    expected: [0,1]
templates:
  javascript: |
    function solution(input) {
      const { nums, target } = input;
      // Your code here
      return [];
    }
  typescript: |
    function solution(input: { nums: number[], target: number }): number[] {
      const { nums, target } = input;
      // Your code here
      return [];
    }
  python: |
    def solution(input):
        nums = input['nums']
        target = input['target']
        # Your code here
        return []
  racket: |
    #lang racket

    (define (solution input)
      (let ([nums (hash-ref input 'nums)]
            [target (hash-ref input 'target)])
        ;; Your code here
        '()))
---

## 题目

给定一个整数数组 `nums` 和一个整数 `target`，返回 **两个数之和等于 target 的下标**。

你可以假设每种输入只会对应一个答案，并且同一个元素不能使用两次。
