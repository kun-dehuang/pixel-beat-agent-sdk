# Pixel Beat Backend - API 接口文档

## 概述

Pixel Beat Backend 是一个基于纯 Agent 架构的照片分析和故事生成服务。所有照片分析、记忆检索、故事生成都由 Agent 自主决策完成。

**服务地址**: `http://localhost:3000`
**版本**: `v3.0.0-pure-agent`
**架构**: Pure Agent Architecture

---

## 目录

- [健康检查](#健康检查)
- [Agent API (核心)](#agent-api-核心)
- [Sync API (兼容层)](#sync-api-兼容层)
- [照片管理 API](#照片管理-api)
- [故事 API](#故事-api)
- [人设 API](#人设-api)
- [策略 API](#策略-api)

---

## 健康检查

### GET /health

检查服务健康状态。

**请求示例**:
```bash
curl -X GET http://localhost:3000/health
```

**响应示例**:
```json
{
  "status": "ok",
  "version": "3.0.0-pure-agent",
  "architecture": "pure-agent",
  "memoriesLoaded": 914,
  "personaFrozen": true,
  "activeSessions": 3,
  "timestamp": "2025-02-06T10:30:00.000Z"
}
```

---

## Agent API (核心)

### POST /api/agent/run

运行 Agent 完成照片分析 → 记忆检索 → 故事生成 → 质量评估的完整流程。

**请求头**:
```
Content-Type: application/json
```

**请求体**:
```json
{
  "userId": "user_123",
  "photos": [
    {
      "base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "mimeType": "image/jpeg"
    }
  ],
  "preferredStyle": "natural",
  "generateStory": true,
  "iterations": 1
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | string | 否 | 用户ID，默认 `demo_user` |
| photos | array | 是 | 照片数组，每张照片包含 base64 和 mimeType |
| preferredStyle | string | 否 | 故事风格: `natural` \| `literary` \| `humorous` |
| generateStory | boolean | 否 | 是否生成故事，默认 true |
| iterations | number | 否 | 运行次数（1-5），默认 1 |

**响应示例**:
```json
{
  "status": "success",
  "photoAnalysis": {
    "setting": "城市街道，现代建筑",
    "objects": ["建筑", "街道", "天空"],
    "atmosphere": "现代，都市",
    "colors": ["蓝色", "灰色"]
  },
  "storyOptions": [
    {
      "id": "option_1",
      "story": {
        "title": "城市一瞥",
        "body": "漫步在现代都市的街道上..."
      },
      "discoveryAngle": "审美价值",
      "engagementScore": 8.5,
      "viralBreakdown": {
        "gossip": 2,
        "hotness": 8,
        "status": 7,
        "class": 6,
        "memory": 9
      },
      "likelyReactions": ["太美了！", "在哪里？"],
      "debug": {
        "turns": 5,
        "steps": []
      }
    }
  ],
  "iterationCount": 1,
  "discoveryAngle": "审美价值",
  "memoryConnections": [
    {
      "angle_type": "时间线",
      "memory_id": "mem_001",
      "description": "上次去城市拍照",
      "confidence": 0.85
    }
  ],
  "persona": {
    "identity": "摄影师",
    "interests": ["城市摄影", "建筑"]
  },
  "personaFrozen": true,
  "story": {
    "title": "城市一瞥",
    "body": "漫步在现代都市的街道上..."
  },
  "engagementScore": 8.5,
  "viralBreakdown": {
    "gossip": 2,
    "hotness": 8,
    "status": 7,
    "class": 6,
    "memory": 9
  },
  "likelyReactions": ["太美了！", "在哪里？"],
  "debug": {
    "agentTurns": 5,
    "agentSteps": [],
    "totalTokens": 3500,
    "totalLatencyMs": 15000,
    "memoriesUsed": 914,
    "iterationsRun": 1
  }
}
```

**cURL 示例**:
```bash
curl -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "photos": [{
      "base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "mimeType": "image/jpeg"
    }],
    "preferredStyle": "natural",
    "generateStory": true
  }'
```

---

### POST /api/agent/analyze

仅分析照片，不生成人设和故事。

**请求体**:
```json
{
  "userId": "user_123",
  "photos": [
    {
      "base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "mimeType": "image/jpeg"
    }
  ]
}
```

**响应示例**:
```json
{
  "status": "success",
  "photoAnalysis": {
    "setting": "城市街道，现代建筑",
    "objects": ["建筑", "街道", "天空"],
    "atmosphere": "现代，都市",
    "colors": ["蓝色", "灰色"]
  },
  "debug": {
    "turns": 2,
    "totalTokens": 800,
    "totalLatencyMs": 3000
  }
}
```

---

### GET /api/agent/health

Agent 服务健康检查。

**响应示例**:
```json
{
  "status": "ok",
  "activeSessions": 3,
  "timestamp": "2025-02-06T10:30:00.000Z"
}
```

---

### DELETE /api/agent/session/:userId

清除用户的 Agent 会话。

**URL 参数**:
- `userId` - 用户ID

**响应示例**:
```json
{
  "success": true,
  "message": "Session for user_123 cleared"
}
```

---

### GET /api/agent/sessions

列出所有活跃的 Agent 会话。

**响应示例**:
```json
{
  "count": 3,
  "userIds": ["user_123", "user_456", "user_789"]
}
```

---

## Sync API (兼容层)

### POST /api/sync/detect

检测新增照片（实际检测由客户端完成，服务端返回元数据）。

**请求体**:
```json
{
  "userId": "user_123",
  "lastSyncedAt": "2025-02-01T00:00:00.000Z"
}
```

**响应示例**:
```json
{
  "newPhotosCount": 0,
  "newPhotoIds": [],
  "lastSyncedAt": "2025-02-01T00:00:00.000Z"
}
```

---

### POST /api/sync/execute

执行增量同步（兼容旧接口，内部调用 Agent）。

**请求体**:
```json
{
  "userId": "user_123",
  "photoData": [
    {
      "base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "mimeType": "image/jpeg"
    }
  ],
  "generateStory": true,
  "styleId": "natural"
}
```

**响应示例**:
```json
{
  "syncId": "uuid-123-456",
  "status": "completed",
  "summary": {
    "newPhotosCount": 1,
    "analyzedCount": 1,
    "personaUpdated": false,
    "storyGenerated": true,
    "storyOptionsCount": 1
  },
  "photoAnalysis": {
    "setting": "城市街道",
    "objects": ["建筑", "街道"],
    "atmosphere": "现代",
    "colors": ["蓝色", "灰色"]
  },
  "persona": {
    "identity": "摄影师",
    "interests": ["城市摄影"]
  },
  "personaFrozen": true,
  "personaChanges": [],
  "story": {
    "id": "story-uuid",
    "content": "城市一瞥\n\n漫步在现代都市...",
    "style": "natural",
    "photoCount": 1,
    "createdAt": "2025-02-06T10:30:00.000Z",
    "debug": {
      "tokenUsage": 3500,
      "latencyMs": 15000
    }
  },
  "storyOptions": [
    {
      "id": "story-uuid",
      "angle": "审美价值",
      "title": "城市一瞥",
      "body": "漫步在现代都市...",
      "style": "natural",
      "confidence": 0.85,
      "viralScore": {
        "total": 8.5,
        "gossip": 2,
        "hotness": 8,
        "status": 7,
        "class": 6,
        "memory": 9
      },
      "likelyReactions": ["太美了！", "在哪里？"],
      "memoryConnections": [
        {
          "angleType": "时间线",
          "memoryId": "mem_001",
          "description": "上次去城市拍照",
          "confidence": 0.85
        }
      ],
      "iterationHistory": [
        {
          "iteration": 1,
          "caption": "初步文案...",
          "photoIds": ["photo_001"],
          "auditScore": 6.5,
          "strategy": "情感共鸣"
        },
        {
          "iteration": 2,
          "caption": "优化后的文案...",
          "photoIds": ["photo_001"],
          "auditScore": 7.8,
          "strategy": "故事化"
        }
      ]
    }
  ],
  "discoveryAngle": "审美价值",
  "memoryConnections": [],
  "engagementScore": 8.5,
  "viralBreakdown": {
    "gossip": 2,
    "hotness": 8,
    "status": 7,
    "class": 6,
    "memory": 9
  },
  "likelyReactions": ["太美了！", "在哪里？"],
  "debug": {
    "strategyId": "agent_v2",
    "totalTokenUsage": 3500,
    "totalLatencyMs": 15000,
    "agentTurns": 5,
    "agentSteps": ["analyze_photos", "retrieve_memories", "generate_story"]
  }
}
```

---

### POST /api/sync/multi-story ⭐ NEW

生成多个故事（智能聚类）。

**功能说明**: 使用 ai-moments 的多故事功能，自动将照片聚类为多个主题并生成独立故事。每个故事都会经过 5 轮迭代优化。

**请求体**:
```json
{
  "userId": "user_123",
  "photoAnalysis": "{\"images\":[{\"image_id\":\"img_001\",\"description\":\"城市街道，现代建筑\",\"objects\":[\"建筑\",\"街道\"],\"emotions\":[\"现代\",\"都市\"],\"colors\":[\"蓝色\",\"灰色\"],\"metadata\":{\"time\":\"14:00\",\"location\":\"市中心\"}}],\"overall_theme\":\"城市一日\",\"mood\":\"轻松\"}",
  "styleId": "natural"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | string | 否 | 用户ID，默认 `demo_user` |
| photoAnalysis | string | 是 | VLM 分析结果（JSON 字符串格式） |
| styleId | string | 否 | 故事风格，默认 `natural` |

**photoAnalysis 格式说明**:
```json
{
  "images": [
    {
      "image_id": "img_001",
      "description": "城市街道，现代建筑，高楼大厦",
      "objects": ["建筑", "街道", "天空"],
      "emotions": ["现代", "都市", "活力"],
      "colors": ["蓝色", "灰色", "白色"],
      "metadata": {
        "time": "14:00",
        "location": "市中心",
        "weather": "晴天"
      }
    }
  ],
  "overall_theme": "城市一日",
  "mood": "轻松"
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "success": true,
    "total_stories": 2,
    "stories": [
      {
        "story_id": 0,
        "theme": "城市建筑摄影",
        "image_ids": ["img_001", "img_002"],
        "moment_result": {
          "moment": {
            "captions": {
              "primary": {
                "text": "现代都市的建筑美学，玻璃幕墙映照着蓝天白云...",
                "strategy": "审美价值"
              }
            }
          },
          "iteration": 5,
          "history_attempts": {
            "iteration_1": {
              "audit": {
                "total_score": 6.5
              },
              "decision": {
                "thought_trace": "初步分析，发现建筑主题突出..."
              }
            },
            "iteration_2": {
              "audit": {
                "total_score": 7.2
              },
              "decision": {
                "thought_trace": "加强情感表达，添加时间维度..."
              }
            }
          }
        }
      },
      {
        "story_id": 1,
        "theme": "休闲时光",
        "image_ids": ["img_003"],
        "moment_result": {
          "moment": {
            "captions": {
              "primary": {
                "text": "午后的阳光透过窗户洒进来...",
                "strategy": "情感共鸣"
              }
            }
          },
          "iteration": 5,
          "history_attempts": {}
        }
      }
    ],
    "summary": "基于照片内容，生成了2个主题故事：城市建筑摄影和休闲时光"
  },
  "debug": {
    "latencyMs": 192000,
    "tokenUsage": 0
  }
}
```

**cURL 示例**:
```bash
curl -X POST http://localhost:3000/api/sync/multi-story \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "photoAnalysis": "{\"images\":[...],\"overall_theme\":\"城市一日\",\"mood\":\"轻松\"}",
    "styleId": "natural"
  }'
```

**注意**:
- 请求耗时约 3-5 分钟（取决于照片数量和故事数量）
- AI_MOMENTS_TIMEOUT 需要设置为至少 300000ms (5分钟)
- 需要启动 ai-moments 服务（端口 8001）

---

## 照片管理 API

### POST /api/photos/upload

注册照片元数据（返回上传凭证）。

**请求体**:
```json
{
  "userId": "user_123",
  "photos": [
    {
      "localAssetId": "asset-001",
      "filename": "photo.jpg",
      "mimeType": "image/jpeg",
      "takenAt": "2025-02-06T10:00:00.000Z",
      "latitude": 37.7749,
      "longitude": -122.4194
    }
  ]
}
```

**响应示例**:
```json
{
  "success": true,
  "count": 1,
  "uploads": [
    {
      "photoId": "uuid-001",
      "localAssetId": "asset-001",
      "filename": "photo.jpg",
      "mimeType": "image/jpeg",
      "takenAt": "2025-02-06T10:00:00.000Z",
      "latitude": 37.7749,
      "longitude": -122.4194,
      "status": "pending_upload"
    }
  ]
}
```

---

### POST /api/photos/upload-file

实际文件上传（multipart/form-data）。

**请求**:
```
Content-Type: multipart/form-data

photos: [File1, File2, ...]
```

**响应示例**:
```json
{
  "success": true,
  "count": 2,
  "photos": [
    {
      "id": "uuid-001",
      "originalName": "photo1.jpg",
      "mimeType": "image/jpeg",
      "size": 2048576,
      "status": "uploaded"
    }
  ]
}
```

---

### POST /api/photos/register

注册已上传的照片（记录元数据）。

**请求体**:
```json
{
  "photos": [
    {
      "id": "uuid-001",
      "localAssetId": "asset-001",
      "storageUrl": "https://storage.example.com/photo.jpg",
      "thumbnailUrl": "https://storage.example.com/thumb.jpg",
      "takenAt": "2025-02-06T10:00:00.000Z",
      "latitude": 37.7749,
      "longitude": -122.4194
    }
  ]
}
```

**响应示例**:
```json
{
  "success": true,
  "count": 1,
  "photos": [
    {
      "id": "uuid-001",
      "localAssetId": "asset-001",
      "storageUrl": "https://storage.example.com/photo.jpg",
      "thumbnailUrl": "https://storage.example.com/thumb.jpg",
      "metadata": {
        "takenAt": "2025-02-06T10:00:00.000Z",
        "latitude": 37.7749,
        "longitude": -122.4194
      },
      "status": "registered"
    }
  ]
}
```

---

### GET /api/photos

获取照片列表。

**查询参数**:
- `userId` - 用户ID
- `limit` - 返回数量，默认 50
- `offset` - 偏移量，默认 0

**响应示例**:
```json
{
  "photos": [],
  "total": 0,
  "limit": 50,
  "offset": 0
}
```

---

### GET /api/photos/last-sync

获取上次同步时间。

**查询参数**:
- `userId` - 用户ID

**响应示例**:
```json
{
  "lastSyncedAt": null,
  "userId": "user_123"
}
```

---

## 故事 API

### GET /api/stories

获取故事列表。

**查询参数**:
- `userId` - 用户ID
- `limit` - 返回数量，默认 20
- `offset` - 偏移量，默认 0

**响应示例**:
```json
{
  "stories": [],
  "total": 0,
  "limit": 20,
  "offset": 0
}
```

---

### GET /api/stories/:id

获取单个故事详情。

**URL 参数**:
- `id` - 故事ID

**响应**: `404 Not Found` (未实现)

---

### POST /api/stories/generate

生成故事。

**请求体**:
```json
{
  "personaSummary": "摄影师，热爱城市摄影",
  "photoAnalysis": "{\"setting\":\"城市街道\",\"objects\":[\"建筑\",\"街道\"]}",
  "styleId": "natural",
  "photoIds": ["photo_001"]
}
```

**响应示例**:
```json
{
  "story": {
    "id": "story-uuid",
    "content": "城市一瞥\n\n漫步在现代都市的街道上...",
    "style": "natural",
    "photoIds": ["photo_001"],
    "createdAt": "2025-02-06T10:30:00.000Z",
    "debug": {
      "strategyId": "agent_v2",
      "tokenUsage": 1500,
      "latencyMs": 5000
    }
  }
}
```

---

### POST /api/stories/regenerate/:id

重新生成故事。

**URL 参数**:
- `id` - 故事ID

**请求体**:
```json
{
  "styleId": "literary"
}
```

**响应**: `501 Not Implemented` (未实现)

---

### POST /api/stories/compare

对比不同策略生成的故事。

**请求体**:
```json
{
  "personaSummary": "摄影师，热爱城市摄影",
  "photoAnalysis": "{\"setting\":\"城市街道\",\"objects\":[\"建筑\",\"街道\"]}",
  "styles": ["natural", "literary", "humorous"]
}
```

**响应示例**:
```json
{
  "strategyId": "agent_v2",
  "comparisons": [
    {
      "styleId": "natural",
      "content": "城市一瞥\n\n漫步在现代都市...",
      "tokenUsage": 1500,
      "latencyMs": 5000
    },
    {
      "styleId": "literary",
      "content": "都市之诗\n\n水泥森林中...",
      "tokenUsage": 1800,
      "latencyMs": 6000
    },
    {
      "styleId": "humorous",
      "content": "当建筑师偷懒...\n\n你看这建筑...",
      "tokenUsage": 1600,
      "latencyMs": 5500
    }
  ]
}
```

---

## 人设 API

### GET /api/persona

获取当前用户的人设（调试阶段返回基于历史记忆的固定人设）。

**查询参数**:
- `userId` - 用户ID

**响应示例**:
```json
{
  "persona": {
    "identity": "摄影师",
    "interests": ["城市摄影", "建筑", "旅行"],
    "style": "现代简约"
  },
  "exists": true,
  "frozen": true,
  "note": "调试阶段：人设基于914条历史记忆固定生成，不会被新照片更新"
}
```

---

### POST /api/persona/generate

生成/更新人设。

**请求体**:
```json
{
  "observations": "用户拍摄了城市建筑照片",
  "existingPersona": {
    "identity": "摄影师",
    "interests": ["摄影"]
  },
  "mode": "incremental"
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| observations | string | 新的观察结果（必填） |
| existingPersona | object | 现有人设（可选） |
| mode | string | 模式: `incremental` \| `full` |

**响应示例**:
```json
{
  "persona": {
    "id": "persona-uuid",
    "version": 2,
    "profile": {
      "identity": "城市摄影师",
      "interests": ["城市摄影", "建筑"]
    },
    "updatedAt": "2025-02-06T10:30:00.000Z"
  },
  "changes": [
    {
      "dimension": "general",
      "type": "updated",
      "detail": "基于新观察更新了人设"
    }
  ],
  "debug": {
    "strategyId": "agent_v2",
    "mode": "incremental",
    "tokenUsage": 2000,
    "latencyMs": 7000
  }
}
```

---

### POST /api/persona/regenerate

完全重新生成人设（基于所有历史照片）。

**请求体**:
```json
{
  "userId": "user_123"
}
```

**响应**: `501 Not Implemented` (未实现)

---

### GET /api/persona/history

获取人设变化历史。

**查询参数**:
- `userId` - 用户ID
- `limit` - 返回数量，默认 10

**响应示例**:
```json
{
  "history": [],
  "total": 0
}
```

---

## 策略 API

### GET /api/strategies/current

获取当前生效的策略配置。

**响应示例**:
```json
{
  "id": "agent_v2",
  "name": "Pure Agent Architecture v2",
  "version": "3.0.0",
  "models": {
    "llm": "glm-4-flash",
    "vlm": "gemini-2.0-flash"
  },
  "pipeline": [
    "analyze_photos",
    "retrieve_memories",
    "generate_story",
    "predict_engagement"
  ],
  "persona": {
    "enabled": true,
    "mode": "fixed"
  },
  "story": {
    "default_style": "natural",
    "available_styles": [
      "natural",
      "literary",
      "humorous"
    ]
  }
}
```

---

### GET /api/strategies/styles

获取可用的故事风格列表。

**响应示例**:
```json
{
  "defaultStyle": "natural",
  "styles": [
    {
      "id": "natural",
      "name": "自然风格",
      "description": "平实自然的叙述方式"
    },
    {
      "id": "literary",
      "name": "文学风格",
      "description": "优美的文学表达"
    },
    {
      "id": "humorous",
      "name": "幽默风格",
      "description": "轻松幽默的语调"
    }
  ]
}
```

---

## 错误响应

所有错误响应遵循统一格式：

```json
{
  "status": "error",
  "error": "错误描述信息"
}
```

常见 HTTP 状态码：
- `400 Bad Request` - 请求参数错误
- `404 Not Found` - 资源不存在
- `500 Internal Server Error` - 服务器内部错误
- `501 Not Implemented` - 功能未实现

---

## 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| PORT | 服务端口 | 3000 |
| USE_AI_MOMENTS | 是否启用 ai-moments | false |
| AI_MOMENTS_API | ai-moments 服务地址 | http://localhost:8001 |
| AI_MOMENTS_TIMEOUT | ai-moments 超时时间 (ms) | 300000 |

### Agent 流程

1. **analyze_photos** - VLM 图片识别
2. **retrieve_memories** - 4-Path 海马体检索
3. **generate_story** - 第三人称故事生成
4. **predict_engagement** - 5维流量评分

### 支持的故事风格

| 风格ID | 名称 | 说明 |
|--------|------|------|
| natural | 自然风格 | 平实自然的叙述方式 |
| literary | 文学风格 | 优美的文学表达 |
| humorous | 幽默风格 | 轻松幽默的语调 |

---

## 版本历史

- **v3.0.0** - 纯 Agent 架构
- **v2.0.0** - 多故事功能集成
- **v1.0.0** - 初始版本

---

## 联系方式

如有问题，请联系开发团队或提交 Issue。
