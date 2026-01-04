---
id: 5
title: Merge Two Sorted Lists
difficulty: Easy
description: Merge two sorted lists.
examples:
  - input: "list1 = [1,2,4], list2 = [1,3,4]"
    output: "[1,1,2,3,4,4]"
  - input: "list1 = [], list2 = []"
    output: "[]"
constraints:
  - "The number of nodes in both lists is in the range [0, 50]"
  - "-100 <= Node.val <= 100"
testCases:
  - input: {"list1": [1,2,4], "list2": [1,3,4]}
    expected: [1,1,2,3,4,4]
  - input: {"list1": [], "list2": []}
    expected: []
  - input: {"list1": [], "list2": [0]}
    expected: [0]
templates:
  javascript: |
    function solution(input) {
      const { list1, list2 } = input;
      // Your code here
      return [];
    }
  typescript: |
    function solution(input: { list1: number[], list2: number[] }): number[] {
      const { list1, list2 } = input;
      // Your code here
      return [];
    }
  python: |
    def solution(input):
        list1 = input['list1']
        list2 = input['list2']
        # Your code here
        return []
  racket: |
    #lang racket

    (define (solution input)
      (let ([list1 (hash-ref input 'list1)]
            [list2 (hash-ref input 'list2)])
        ;; Your code here
        '()))
---

## 题目

给定两个有序数组（用数组模拟链表节点值）`list1` 和 `list2`，请将它们合并成一个有序数组。

> 注：这里为了在浏览器内执行，题面把链表简化成数组。
