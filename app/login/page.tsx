import Image from "next/image";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{
        background:
          "radial-gradient(120% 100% at 50% 0%, #0b3a3d 0%, #052a2d 55%, #041d1f 100%)",
      }}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Image
          src="/logo.png"
          alt="Social Net"
          width={56}
          height={56}
          priority
          className="brightness-0 invert"
        />
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Normfest Sales Assistant</CardTitle>
            <CardDescription>Melde dich mit deinem Konto an.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={login} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Passwort</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="mt-2">
                Anmelden
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
