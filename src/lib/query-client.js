import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
        defaultOptions: {
                queries: {
                        refetchOnWindowFocus: false,
                        retry: 1,
                        staleTime: 3 * 60 * 1000,
                        gcTime: 10 * 60 * 1000,
                },
        },
});
