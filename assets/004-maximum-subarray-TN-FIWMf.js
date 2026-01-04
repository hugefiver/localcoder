const n=`---
id: 4
title: Maximum Subarray
difficulty: Medium
description: Find the contiguous subarray with the largest sum.
examples:
  - input: "nums = [-2,1,-3,4,-1,2,1,-5,4]"
    output: "6"
    explanation: "[4,-1,2,1] has the largest sum = 6."
  - input: "nums = [1]"
    output: "1"
constraints:
  - "1 <= nums.length <= 10^5"
  - "-10^4 <= nums[i] <= 10^4"
testCases:
  - input: {"nums": [-2,1,-3,4,-1,2,1,-5,4]}
    expected: 6
  - input: {"nums": [1]}
    expected: 1
  - input: {"nums": [5,4,-1,7,8]}
    expected: 23
templates:
  javascript: |
    function solution(input) {
      const { nums } = input;
      // Your code here
      return 0;
    }
  typescript: |
    function solution(input: { nums: number[] }): number {
      const { nums } = input;
      // Your code here
      return 0;
    }
  python: |
    def solution(input):
        nums = input['nums']
        # Your code here
        return 0
  racket: |
    #lang racket

    (define (solution input)
      (let ([nums (hash-ref input 'nums)])
        ;; Your code here
        0))
---

## 题目

给定一个整数数组 \`nums\`，找到一个具有最大和的 **连续子数组**（至少包含一个元素），返回其最大和。
`;export{n as default};
