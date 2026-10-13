import '@testing-library/jest-dom'

vi.mock('@base44/sdk', () => {
  const mockEntities = new Proxy({}, {
    get: () => ({
      filter: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({}),
    })
  })

  return {
    default: {
      auth: {
        me: vi.fn().mockResolvedValue(null),
        login: vi.fn(),
        logout: vi.fn(),
      },
      entities: mockEntities,
      files: {
        upload: vi.fn().mockResolvedValue({ url: 'https://example.com/file.jpg' }),
      },
    },
    base44: {
      auth: {
        me: vi.fn().mockResolvedValue(null),
        login: vi.fn(),
        logout: vi.fn(),
      },
      entities: mockEntities,
      files: {
        upload: vi.fn().mockResolvedValue({ url: 'https://example.com/file.jpg' }),
      },
    },
  }
})
