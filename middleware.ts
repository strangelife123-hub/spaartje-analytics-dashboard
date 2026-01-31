import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SECRET_KEY = process.env.DASHBOARD_SECRET_KEY || 'spaartje2024';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Skip for static files and api routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check for key in URL or cookie
  const urlKey = searchParams.get('key');
  const cookieKey = request.cookies.get('dashboard_key')?.value;

  if (urlKey === SECRET_KEY) {
    // Valid key in URL - set cookie and redirect to clean URL
    const response = NextResponse.redirect(new URL(pathname, request.url));
    response.cookies.set('dashboard_key', SECRET_KEY, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return response;
  }

  if (cookieKey === SECRET_KEY) {
    // Valid key in cookie
    return NextResponse.next();
  }

  // No valid key - show access denied
  if (pathname !== '/access-denied') {
    return NextResponse.redirect(new URL('/access-denied', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
