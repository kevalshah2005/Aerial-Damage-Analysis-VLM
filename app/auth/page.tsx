'use client';

import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true';

export default function AuthPage() {
  const { authStatus } = useAuthenticator(context => [context.authStatus]);
  const router = useRouter();

  useEffect(() => {
    if (skipAuth || authStatus === 'authenticated') {
      router.push('/');
    }
  }, [authStatus, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      {/* Custom styles for Amplify Authenticator */}
      <style jsx global>{`
        :root {
          --amplify-colors-brand-primary-80: hsl(var(--primary));
          --amplify-colors-brand-primary-90: hsla(var(--primary), 0.9);
          --amplify-colors-brand-primary-100: hsl(var(--primary));
          --amplify-colors-background-primary: transparent;
          --amplify-colors-background-secondary: hsla(var(--secondary), 0.5);
          --amplify-colors-border-primary: hsl(var(--border));
          --amplify-colors-font-primary: hsl(var(--foreground));
          --amplify-colors-font-secondary: hsl(var(--muted-foreground));
          --amplify-colors-font-tertiary: hsla(var(--muted-foreground), 0.8);
          --amplify-components-fieldcontrol-border-color: hsl(var(--border));
          --amplify-components-fieldcontrol-focus-border-color: hsl(var(--primary));
          --amplify-components-button-primary-background-color: hsl(var(--primary));
          --amplify-components-button-primary-hover-background-color: hsla(var(--primary), 0.9);
          --amplify-components-tabs-item-active-border-color: hsl(var(--primary));
          --amplify-components-tabs-item-active-color: hsl(var(--primary));
          --amplify-components-tabs-item-color: hsl(var(--muted-foreground));
          --amplify-components-authenticator-container-width: 100%;
        }

        [data-amplify-authenticator] {
          --amplify-components-authenticator-box-shadow: none !important;
          --amplify-components-authenticator-border-width: 0;
          box-shadow: none !important;
          background-color: transparent !important;
          width: 100%;
          margin: 0 auto;
        }

        .amplify-authenticator__container,
        .amplify-authenticator__form,
        .amplify-card {
          box-shadow: none !important;
          border: none !important;
          background: transparent !important;
        }

        .amplify-authenticator__container {
          width: 100% !important;
          margin: 0 !important;
        }

        .amplify-tabs {
          border-bottom: 1px solid hsl(var(--border));
          margin-bottom: 1.5rem;
        }

        .amplify-input {
          border-radius: var(--radius);
          background-color: hsla(var(--secondary), 0.3) !important;
        }
      `}</style>

      <div className="flex flex-col items-center w-full max-w-xl">
        <div className="w-full bg-card border border-border rounded-xl overflow-hidden">
          <div className="pt-10 pb-6 px-8 text-center bg-muted/20 border-b border-border">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary/15 mb-4 border border-primary/20">
              <svg 
                className="h-6 w-6 text-primary" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor" 
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              GeoView
            </h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
              Sign in to start analyzing aerial imagery with AI
            </p>
          </div>
          
          <div className="p-6 sm:p-10">
            <Authenticator hideSignUp={false} />
          </div>
        </div>

        <p className="mt-8 text-xs text-muted-foreground text-center">
          &copy; {new Date().getFullYear()} GeoView Aerial Systems. All rights reserved.
        </p>
      </div>
    </div>
  );
}
